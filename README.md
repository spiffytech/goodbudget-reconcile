This is a simple command line script that reconciles a GoodBudget export against a CSV of bank transactions. 

The bank CSV has these columns:
`"Date","Description","Original Description","Amount","Transaction Type","Category","Account Name","Labels","Notes"`

These are the same as Mint's export.

Run this script like so:

`ts-node index.ts --gb-file ~/Downloads/history*csv(om[1]) --bank-file ~/Downloads/checking.csv --start-date "2017-11-12" --gb-account='Checking'`
