import { SDK } from "codechain-sdk";
import * as sleep from "sleep";
import * as request from "request-promise-native";
import * as config from "config";
import { BigNumber } from "bignumber.js";

interface Account {
    address: string;
    balance: BigNumber;
}

function getRandomAccount(accounts: Account[], totalBalance: BigNumber): string {
    const random = new BigNumber(Math.random()).multipliedBy(totalBalance);
    const lastIndex = accounts.length - 1;
    let sum = new BigNumber(0);

    for (let i = 0; i < lastIndex; i++) {
        sum = sum.plus(accounts[i].balance);
        if (random.isLessThan(sum)) {
            return accounts[i].address;
        }
    }
    return accounts[lastIndex].address;
}

async function fetchAccounts(): Promise<Account[]> {
    const items: [{ address: string, balance: string }] = await request({
        url: config.get("accounts_url").toString(),
        json: true
    });

    return items.map((item) => {
        const address = item["address"];
        // FIXME: balance is a big number. parseInt can fail.
        const balance = new BigNumber(item["balance"], 10);
        return { address, balance };
    });
}

async function chooseAccount(payer: string): Promise<string> {
    const accounts = (await fetchAccounts()).filter((account) => account.address !== payer);
    const totalBalance = accounts.reduce((acc, account) => account.balance.plus(acc), new BigNumber(0));
    return getRandomAccount(accounts, totalBalance);
}

async function main() {
    const rpcUrl = config.get<string>("rpc_url");
    if (!rpcUrl) {
        console.error("rpc_url is not specified");
        process.exit(-1);
    }
    const sdk = new SDK({ server: rpcUrl });

    const keyStore = await sdk.key.createLocalKeyStore();

    const payer = config.get<string>("payer.payer");
    if (!payer) {
        console.error("payer.payer is not specified");
        process.exit(-1);
    }

    const payerPassphrase = config.get<string>("payer.payer_passphrase");
    if (!payerPassphrase) {
        console.error("payer.payer_passphrase is not specified");
        process.exit(-1);
    }

    const reward = config.get<number>("reward");
    if (!reward) {
        console.error("reward is not specified");
        process.exit(-1);
    }
    const dropInterval = config.get<number>("drop_interval");

    while (true) {
        try {
            const winner = await chooseAccount(payer);

            const parcel = sdk.core.createPaymentParcel({
                recipient: winner,
                amount: reward
            });

            const nonce = await sdk.rpc.chain.getNonce(payer);

            const signedParcel = await sdk.key.signParcel(parcel, {
                account: payer,
                keyStore,
                fee: 10,
                nonce,
                passphrase: payerPassphrase,
            });
            await sdk.rpc.chain.sendSignedParcel(signedParcel);
            console.log(winner + " has won the lottery!");

        } catch (err) {
            console.error(err);
        }

        sleep.sleep(dropInterval);
    }
}

main();