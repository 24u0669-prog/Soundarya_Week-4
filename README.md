# Spendwise — Personal Expense Tracker

A Java-powered expense tracker with a responsive web dashboard. Java serves the
dashboard, validates input, provides the HTTP API, calculates spending totals,
and persists categories and expenses. The HTML, CSS, and JavaScript frontend
provides the interactive dashboard and makes up the lightweight web layer.

## Requirements

- JDK 21 or newer
- No external dependencies or build tools

## Run on Windows

From the project directory:

```powershell
javac -d out src\main\java\com\expense\tracker\ExpenseTrackerServer.java
java -cp out com.expense.tracker.ExpenseTrackerServer
```

Then open <http://localhost:8080>.

The server listens on localhost only. By default, expense data is stored in
`%APPDATA%\expense-tracker\expenses.tsv` (or `~/.local/share/expense-tracker/expenses.tsv`
on other systems). To select a different data file:

```powershell
java "-Dexpense.data=.\my-expenses.tsv" -cp out com.expense.tracker.ExpenseTrackerServer
```

## Dashboard features

- Overview cards for total spending, this month's spending, and transactions.
- Add, edit, and delete expenses with date, amount, category, and description.
- Search and filter by category or date range.
- Category totals and progress bars, with add/remove category controls.
- Password-protected local diary with sign-in and lock controls.
- Responsive layout for desktop and mobile screens.
- Input validation, clear error messages, and atomic local persistence.

Currency is currently displayed in Indian rupees (INR). The dashboard is intended
for personal use on the local machine. The password protects access to the diary
on this machine; it is not intended to provide remote-access controls.

## Legacy console version

The original Python console implementation remains in `expense_tracker.py`. Its
tests can still be run with:

```powershell
python -m unittest discover -s tests -v
```

## Author

**Soundarya Umesh Barigidad**  
**Information Science Engineering Student**
