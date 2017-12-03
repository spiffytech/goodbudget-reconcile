import * as csv from 'csv-parse';
import * as fs from 'fs';
import * as moment from 'moment';
import * as nconf from 'nconf';

nconf.argv().env().required(['bank-file', 'gb-file', 'gb-account']);

interface Txn {
    date: Date;
    payee: string;
    amount: number;
    account: string;
    source: 'budget' | 'bank';
    pair?: Txn;
}

function readCsv<T>(filename: string) {
  return new Promise<T[]>((resolve, reject) => {
    fs.readFile(filename, (err, contents) => {
      if (err) return reject(err);
      csv(contents.toString(), { columns: true, escape: '\\' }, (err, data) => {
        if (err) return reject(err);
        resolve(data);
      });
    });
  });
}

async function getGoodbudgetTxns(filename: string): Promise<Txn[]> {
    interface GoodbudgetTxnRaw {
        Date: string;
        Envelope: string;
        Account: string;
        Name: string;
        Notes: string;
        Amount: string;
        Status: string;
        Details: string;
    }
    const txnsRaw = await readCsv<GoodbudgetTxnRaw>(filename);
    return txnsRaw.map((txnRaw) => ({
        date: new Date(txnRaw.Date),
        amount: parseFloat(txnRaw.Amount.replace(/,/g, '')),
        payee: txnRaw.Name,
        account: txnRaw.Account,
        source: 'budget' as 'budget',
    })).
    filter((txn) => txn.account !== '[none]').
    sort((a, b) => a.date.getTime() - b.date.getTime());
}

async function getBankTxns(filename: string): Promise<Txn[]> {
    interface BankTxnRaw {
        Date: string;
        Description: string;
        "Original Description": string;
        Amount: number;
        "Transaction Type": string;
        Category: string;
        "Account Name": string;
        Labels: string;
        Notes: string;
    }
    const txnsRaw = await readCsv<BankTxnRaw>(filename);
    return txnsRaw.map((txnRaw) => ({
        date: new Date(txnRaw.Date),
        amount: txnRaw.Amount * (txnRaw["Transaction Type"] === "debit" ? -1 : 1),
        payee: txnRaw.Description,
        account: txnRaw["Account Name"],
        source: 'bank' as 'bank',
    })).
    sort((a, b) => a.date.getTime() - b.date.getTime());
}

type DateWindows = {[timestamp: number]: number};
/**
 * Given an array of dates, returns the array index at which a given date's
 * entries begin
 */
function mkDateWindows(dates: Date[]): DateWindows {
    return dates.reduce(
        (acc, date, index) => {
            if (!acc[date.getTime()]) return {...acc, [date.getTime()]: index};
            return acc;
        },
        {} as DateWindows
    );
}

/**
 * Given transactions and window indexes, find all transactions within
 * windowSize days of the startDate
 */
function getTxnsInWindow(txns: Txn[], windows: DateWindows, startDate: Date, windowSize: number) {
    const endTimestamp = startDate.getTime() + (windowSize * 86400 * 1000);
    /**
     * Finds the first bank transaction occurring on or after our start date
     */
    function findNearestTxn(date: Date): number | undefined {
        return Object.keys(windows).map(parseFloat).find(
            (timestamp) => timestamp >= date.getTime()
        );
    }

    const windowStartDate = findNearestTxn(startDate);
    if (!windowStartDate || windowStartDate >= endTimestamp) return [];
    const windowStartIndex = windows[windowStartDate];

    const windowEndDate = findNearestTxn(new Date(endTimestamp));
    const windowEndIndex = windowEndDate ? windows[windowEndDate] : Number.MAX_SAFE_INTEGER;

    if (startDate.getTime() === new Date("2017-11-28").getTime()) {
        console.log(startDate, new Date(endTimestamp), windowStartIndex, windowEndIndex, windowEndDate);
        Object.keys(windows).map(parseFloat).forEach(ts => console.log(ts, endTimestamp, endTimestamp - ts))
    }
    return txns.slice(windowStartIndex, windowEndIndex)
}

function pairTransactions(budgetTxns: Txn[], bankTxns: Txn[], windowSize=4) {
    const windows = mkDateWindows(bankTxns.map((txn) => txn.date));

    budgetTxns.forEach((txn) => {
        const candidate =
            getTxnsInWindow(bankTxns, windows, txn.date, windowSize).
            filter((candidate) => !candidate.pair).
            filter((candidate) => candidate.amount === txn.amount)[0];
        
        if (!candidate) return;
        txn.pair = candidate;
        candidate.pair = txn;
    });
}

async function main() {
    const goodbudgetAccount = nconf.get('gb-account');
    const goodbudgetTxns =
        (await getGoodbudgetTxns(nconf.get('gb-file'))).
        filter((txn) => txn.account === goodbudgetAccount);
    const bankTxns = await getBankTxns(nconf.get('bank-file'));
    const startDate = new Date(
        Math.max(
            new Date(nconf.get('start-date')).getTime(),
            bankTxns[0].date.getTime()
        )
    );

    pairTransactions(goodbudgetTxns, bankTxns);
    
    const unpaired = [
        ...goodbudgetTxns.filter((txn) => !txn.pair),
        ...bankTxns.filter((txn) => !txn.pair),
    ].
    filter((txn) => txn.date > startDate).
    sort((a, b) => a.date.getTime() - b.date.getTime());

    unpaired.forEach((txn) => {
        const prefix = txn.source === 'bank' ? '\t\t\t\t' : '';
        const date = moment(txn.date).format('MMM D');
        console.log(`${prefix}${date}: ${txn.amount}\t${txn.payee}`)
    });

    /*
    console.log(goodbudgetTxns.filter((txn) => txn.amount === -9.99))
    console.log(bankTxns.filter((txn) => txn.amount === -9.99))
    */
}

main();