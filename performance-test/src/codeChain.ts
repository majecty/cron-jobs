import { SDK } from "codechain-sdk";
import { Block, H256, SignedTransaction } from "codechain-sdk/lib/core/classes";
import { MemoryKeyStore } from "codechain-sdk/lib/key/MemoryKeyStore";
import { TRANSACTION_TIMEOUT } from "./constant";
import { getConfig, waitContainTransacitonSuccess } from "./util";
import UTXOs from "./utxoSet";

type NetworkId = "tc" | "wc";

const networkId: "tc" | "wc" = getConfig<NetworkId>("networkId");
const codeChainRPCURL: string = getConfig<string>("codeChainRPCURL");

export default class CodeChain {
    private sdk: SDK;
    private transientKeyStore: MemoryKeyStore;

    public constructor() {
        this.sdk = new SDK({
            server: codeChainRPCURL,
            networkId,
            keyStoreType: "local"
        });

        this.transientKeyStore = new MemoryKeyStore();
    }

    public getCurrentBlock = async (): Promise<Block> => {
        const bestBlockNumber = await this.sdk.rpc.chain.getBestBlockNumber();
        return (await this.sdk.rpc.chain.getBlock(bestBlockNumber))!;
    };

    public create100UTXOs = async (): Promise<UTXOs> => {
        const utxoSet = new UTXOs(this.sdk, this.transientKeyStore);
        await utxoSet.create100UTXOs();
        return utxoSet;
    };

    public sendTransaction(transaction: SignedTransaction): Promise<H256> {
        return this.sdk.rpc.chain.sendSignedTransaction(transaction);
    }

    public waitTransactionMined = async (txHash: H256): Promise<void> => {
        await waitContainTransacitonSuccess(
            this.sdk,
            txHash,
            TRANSACTION_TIMEOUT
        );
    };

    public containsTransaction = async (txHash: H256): Promise<boolean> => {
        return this.sdk.rpc.chain.containsTransaction(txHash);
    };

    public getBlockOfTransaction = async (
        transaction: SignedTransaction
    ): Promise<Block> => {
        const minedTransaction = (await this.sdk.rpc.chain.getTransaction(
            transaction.hash()
        ))!;
        const minedBlockHash = minedTransaction.blockHash!;
        return (await this.sdk.rpc.chain.getBlock(minedBlockHash))!;
    };
}
