"""A persistent, console-based personal expense tracker."""

from __future__ import annotations

import argparse
import json
import os
import tempfile
import uuid
from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Iterable


class TrackerError(Exception):
    """An expected application or data validation error."""


@dataclass(frozen=True)
class Expense:
    id: str
    date: date
    amount: Decimal
    category: str
    description: str


def validate_amount(value: str | Decimal) -> Decimal:
    try:
        amount = Decimal(value)
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise TrackerError("Enter a valid amount, such as 12.50.") from exc
    if not amount.is_finite() or amount <= 0:
        raise TrackerError("Amount must be a positive number.")
    if amount.as_tuple().exponent < -2:
        raise TrackerError("Amount can have no more than two decimal places.")
    return amount.quantize(Decimal("0.01"))


def validate_date(value: str) -> date:
    try:
        return date.fromisoformat(value.strip())
    except (ValueError, AttributeError) as exc:
        raise TrackerError("Enter a date in YYYY-MM-DD format.") from exc


def validate_category(value: str) -> str:
    name = " ".join(value.strip().split())
    if not name:
        raise TrackerError("Category name cannot be empty.")
    if len(name) > 40:
        raise TrackerError("Category name must be 40 characters or fewer.")
    return name


class ExpenseTracker:
    def __init__(self, data_path: Path):
        self.data_path = data_path
        self.categories: list[str] = []
        self.expenses: list[Expense] = []
        self.load()

    def load(self) -> None:
        if not self.data_path.exists():
            self.categories = ["General"]
            self.expenses = []
            self.save()
            return
        try:
            data = json.loads(self.data_path.read_text(encoding="utf-8"))
            if data.get("schema_version") != 1:
                raise TrackerError("Unsupported expense data file version.")
            categories = [validate_category(item) for item in data["categories"]]
            if len({item.casefold() for item in categories}) != len(categories):
                raise TrackerError("Data file contains duplicate categories.")
            expenses = []
            for item in data["expenses"]:
                category = validate_category(item["category"])
                if category.casefold() not in {name.casefold() for name in categories}:
                    raise TrackerError(f"Expense references missing category: {category}.")
                expenses.append(
                    Expense(
                        id=str(item["id"]),
                        date=validate_date(item["date"]),
                        amount=validate_amount(item["amount"]),
                        category=category,
                        description=self._description(item["description"]),
                    )
                )
            self.categories = categories
            self.expenses = expenses
        except (OSError, json.JSONDecodeError, KeyError, TypeError, TrackerError) as exc:
            raise TrackerError(f"Could not load expense data from {self.data_path}: {exc}") from exc

    def save(self) -> None:
        data = {
            "schema_version": 1,
            "categories": self.categories,
            "expenses": [
                {
                    "id": expense.id,
                    "date": expense.date.isoformat(),
                    "amount": str(expense.amount),
                    "category": expense.category,
                    "description": expense.description,
                }
                for expense in self.expenses
            ],
        }
        self.data_path.parent.mkdir(parents=True, exist_ok=True)
        temp_path: str | None = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                dir=self.data_path.parent,
                prefix=f".{self.data_path.name}.",
                suffix=".tmp",
                delete=False,
            ) as temp_file:
                temp_path = temp_file.name
                json.dump(data, temp_file, indent=2, ensure_ascii=False)
                temp_file.write("\n")
            os.replace(temp_path, self.data_path)
        except OSError as exc:
            if temp_path and os.path.exists(temp_path):
                os.unlink(temp_path)
            raise TrackerError(f"Could not save expense data to {self.data_path}: {exc}") from exc

    @staticmethod
    def _description(value: str) -> str:
        description = " ".join(value.strip().split())
        if not description:
            raise TrackerError("Description cannot be empty.")
        if len(description) > 200:
            raise TrackerError("Description must be 200 characters or fewer.")
        return description

    def _category_name(self, value: str) -> str:
        name = validate_category(value)
        for category in self.categories:
            if category.casefold() == name.casefold():
                return category
        raise TrackerError(f"Unknown category: {name}.")

    def add_category(self, name: str) -> str:
        name = validate_category(name)
        if any(category.casefold() == name.casefold() for category in self.categories):
            raise TrackerError(f"Category already exists: {name}.")
        self.categories.append(name)
        self.categories.sort(key=str.casefold)
        self.save()
        return name

    def rename_category(self, old_name: str, new_name: str) -> str:
        old = self._category_name(old_name)
        new = validate_category(new_name)
        if any(
            category.casefold() == new.casefold() and category != old
            for category in self.categories
        ):
            raise TrackerError(f"Category already exists: {new}.")
        index = self.categories.index(old)
        self.categories[index] = new
        self.expenses = [
            Expense(e.id, e.date, e.amount, new if e.category == old else e.category, e.description)
            for e in self.expenses
        ]
        self.save()
        return new

    def delete_category(self, name: str) -> None:
        category = self._category_name(name)
        if any(expense.category == category for expense in self.expenses):
            raise TrackerError("Move or delete this category's expenses before deleting it.")
        self.categories.remove(category)
        self.save()

    def add_expense(self, expense_date: str, amount: str, category: str, description: str) -> Expense:
        expense = Expense(
            id=uuid.uuid4().hex[:8],
            date=validate_date(expense_date),
            amount=validate_amount(amount),
            category=self._category_name(category),
            description=self._description(description),
        )
        self.expenses.append(expense)
        self.expenses.sort(key=lambda item: (item.date, item.id), reverse=True)
        self.save()
        return expense

    def find_expense(self, expense_id: str) -> Expense:
        matches = [e for e in self.expenses if e.id.startswith(expense_id.strip().lower())]
        if not matches:
            raise TrackerError(f"No expense found for ID: {expense_id}.")
        if len(matches) > 1:
            raise TrackerError("That ID is ambiguous; enter more characters.")
        return matches[0]

    def edit_expense(
        self,
        expense_id: str,
        expense_date: str,
        amount: str,
        category: str,
        description: str,
    ) -> Expense:
        current = self.find_expense(expense_id)
        updated = Expense(
            id=current.id,
            date=validate_date(expense_date),
            amount=validate_amount(amount),
            category=self._category_name(category),
            description=self._description(description),
        )
        self.expenses[self.expenses.index(current)] = updated
        self.expenses.sort(key=lambda item: (item.date, item.id), reverse=True)
        self.save()
        return updated

    def delete_expense(self, expense_id: str) -> Expense:
        expense = self.find_expense(expense_id)
        self.expenses.remove(expense)
        self.save()
        return expense

    def filter_expenses(
        self,
        start: date | None = None,
        end: date | None = None,
        category: str | None = None,
        min_amount: Decimal | None = None,
        max_amount: Decimal | None = None,
    ) -> list[Expense]:
        if start and end and start > end:
            raise TrackerError("Start date must be on or before end date.")
        selected_category = self._category_name(category) if category else None
        return [
            expense
            for expense in self.expenses
            if (start is None or expense.date >= start)
            and (end is None or expense.date <= end)
            and (selected_category is None or expense.category == selected_category)
            and (min_amount is None or expense.amount >= min_amount)
            and (max_amount is None or expense.amount <= max_amount)
        ]

    @staticmethod
    def total(expenses: Iterable[Expense]) -> Decimal:
        return sum((expense.amount for expense in expenses), Decimal("0.00"))

    def totals_by_category(self, expenses: Iterable[Expense]) -> dict[str, Decimal]:
        totals: defaultdict[str, Decimal] = defaultdict(lambda: Decimal("0.00"))
        for expense in expenses:
            totals[expense.category] += expense.amount
        return dict(sorted(totals.items(), key=lambda item: item[0].casefold()))


def default_data_path() -> Path:
    root = os.environ.get("APPDATA") or str(Path.home() / ".local" / "share")
    return Path(root) / "expense-tracker" / "expenses.json"


def format_money(amount: Decimal) -> str:
    return f"${amount:,.2f}"


def display_expenses(expenses: list[Expense]) -> None:
    if not expenses:
        print("\nNo expenses match your criteria.")
        return
    print("\nID       DATE       AMOUNT      CATEGORY             DESCRIPTION")
    print("-" * 79)
    for expense in expenses:
        print(
            f"{expense.id:<8} {expense.date.isoformat():<10} "
            f"{format_money(expense.amount):>10}  {expense.category:<20.20} "
            f"{expense.description}"
        )
    print(f"\n{len(expenses)} expense(s) | Total: {format_money(ExpenseTracker.total(expenses))}")


def prompt_value(label: str, default: str | None = None) -> str:
    suffix = f" [{default}]" if default is not None else ""
    value = input(f"{label}{suffix}: ").strip()
    return value if value else (default if default is not None else "")


def prompt_optional_date(label: str) -> date | None:
    value = prompt_value(label)
    return validate_date(value) if value else None


def manage_categories(tracker: ExpenseTracker) -> None:
    while True:
        print("\nCategories: " + (", ".join(tracker.categories) or "(none)"))
        print("1. Add  2. Rename  3. Delete  0. Back")
        choice = input("Choose an option: ").strip()
        if choice == "0":
            return
        if choice == "1":
            name = tracker.add_category(input("New category name: "))
            print(f"Added category: {name}")
        elif choice == "2":
            old = input("Category to rename: ")
            new = input("New category name: ")
            print(f"Renamed category to: {tracker.rename_category(old, new)}")
        elif choice == "3":
            tracker.delete_category(input("Category to delete: "))
            print("Category deleted.")
        else:
            print("Choose 1, 2, 3, or 0.")


def record_expense(tracker: ExpenseTracker) -> None:
    print("\nCategories: " + ", ".join(tracker.categories))
    expense = tracker.add_expense(
        input("Date (YYYY-MM-DD): "),
        input("Amount: "),
        input("Category: "),
        input("Description: "),
    )
    print(f"Recorded expense {expense.id} for {format_money(expense.amount)}.")


def edit_expense(tracker: ExpenseTracker) -> None:
    expense = tracker.find_expense(input("Expense ID (or unique prefix): "))
    print(f"Press Enter to keep the current value. Categories: {', '.join(tracker.categories)}")
    updated = tracker.edit_expense(
        expense.id,
        prompt_value("Date (YYYY-MM-DD)", expense.date.isoformat()),
        prompt_value("Amount", str(expense.amount)),
        prompt_value("Category", expense.category),
        prompt_value("Description", expense.description),
    )
    print(f"Updated expense {updated.id}.")


def filter_expenses(tracker: ExpenseTracker) -> None:
    print("Leave a field blank to skip that filter.")
    start = prompt_optional_date("From date (YYYY-MM-DD)")
    end = prompt_optional_date("To date (YYYY-MM-DD)")
    category = prompt_value("Category")
    minimum = prompt_value("Minimum amount")
    maximum = prompt_value("Maximum amount")
    expenses = tracker.filter_expenses(
        start=start,
        end=end,
        category=category or None,
        min_amount=validate_amount(minimum) if minimum else None,
        max_amount=validate_amount(maximum) if maximum else None,
    )
    display_expenses(expenses)


def show_summary(tracker: ExpenseTracker) -> None:
    print("Leave dates blank to include all dates.")
    start = prompt_optional_date("From date (YYYY-MM-DD)")
    end = prompt_optional_date("To date (YYYY-MM-DD)")
    expenses = tracker.filter_expenses(start=start, end=end)
    print(f"\nTotal spending: {format_money(tracker.total(expenses))}")
    print(f"Transactions: {len(expenses)}")
    print("By category:")
    for category, amount in tracker.totals_by_category(expenses).items():
        print(f"  {category:<24} {format_money(amount)}")


def show_report(tracker: ExpenseTracker) -> None:
    print("1. Monthly report  2. Category report")
    choice = input("Choose a report: ").strip()
    if choice == "1":
        month = input("Month (YYYY-MM): ").strip()
        try:
            year, month_number = (int(part) for part in month.split("-"))
            if not 1 <= month_number <= 12:
                raise ValueError
        except ValueError as exc:
            raise TrackerError("Enter a valid month in YYYY-MM format.") from exc
        expenses = [e for e in tracker.expenses if e.date.year == year and e.date.month == month_number]
        print(f"\nMonthly report: {year:04d}-{month_number:02d}")
        display_expenses(expenses)
    elif choice == "2":
        print("\nCategory report")
        for category in tracker.categories:
            matching = [e for e in tracker.expenses if e.category == category]
            print(f"  {category:<24} {format_money(tracker.total(matching)):>12}  ({len(matching)} expenses)")
        print(f"  {'Overall total':<24} {format_money(tracker.total(tracker.expenses)):>12}")
    else:
        raise TrackerError("Choose report 1 or 2.")


def run(data_path: Path) -> None:
    tracker = ExpenseTracker(data_path)
    print("Personal Expense Tracker")
    while True:
        print(
            "\n1. Record expense  2. List expenses  3. Spending summary\n"
            "4. Filter expenses  5. Edit expense  6. Delete expense\n"
            "7. Manage categories  8. Reports  0. Exit"
        )
        choice = input("Choose an option: ").strip()
        try:
            if choice == "0":
                print("Your expenses are saved. Goodbye!")
                return
            if choice == "1":
                record_expense(tracker)
            elif choice == "2":
                display_expenses(tracker.expenses)
            elif choice == "3":
                show_summary(tracker)
            elif choice == "4":
                filter_expenses(tracker)
            elif choice == "5":
                edit_expense(tracker)
            elif choice == "6":
                expense = tracker.find_expense(input("Expense ID (or unique prefix): "))
                confirm = input(
                    f"Delete {expense.description} ({format_money(expense.amount)})? [y/N]: "
                ).strip().casefold()
                if confirm == "y":
                    tracker.delete_expense(expense.id)
                    print("Expense deleted.")
                else:
                    print("Deletion cancelled.")
            elif choice == "7":
                manage_categories(tracker)
            elif choice == "8":
                show_report(tracker)
            else:
                print("Choose a number from 0 to 8.")
        except TrackerError as exc:
            print(f"Error: {exc}")
        except (EOFError, KeyboardInterrupt):
            print("\nYour expenses are saved. Goodbye!")
            return


def main() -> None:
    parser = argparse.ArgumentParser(description="Track personal expenses in the console.")
    parser.add_argument(
        "--data",
        type=Path,
        default=default_data_path(),
        help=f"JSON data file (default: {default_data_path()})",
    )
    args = parser.parse_args()
    try:
        run(args.data)
    except TrackerError as exc:
        parser.exit(1, f"Error: {exc}\n")


if __name__ == "__main__":
    main()
