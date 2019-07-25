import { assert } from "chai";
import { SDK } from "codechain-sdk";
import { Asset, AssetAddress } from "codechain-sdk/lib/core/classes";
import { KeyStore } from "codechain-sdk/lib/key/KeyStore";
import * as _ from "lodash";
import { TRANSACTION_TIMEOUT } from "./constant";
import {
    getConfig,
    getCurrentSeq,
    waitContainTransacitonSuccess
} from "./util";

const faucetAddress = getConfig<string>("faucetAddress");
const networkId = getConfig<string>("networkId");

export default class UTXOs {
    private sdk: SDK;
    private pbkhAssets: Asset[];
    private assetOwner: AssetAddress | null;
    private keyStore: KeyStore;

    public constructor(sdk: SDK, keyStore: KeyStore) {
        this.sdk = sdk;
        this.pbkhAssets = [];
        this.assetOwner = null;
        this.keyStore = keyStore;
    }

    public create100UTXOs = async () => {
        const assetOwnerKey = await this.keyStore.asset.createKey();
        this.assetOwner = AssetAddress.fromTypeAndPayload(1, assetOwnerKey, {
            networkId
        });
        {
            const asset = await this.mintAsset();
            const splittedAssets = await this.splitToPBKHAssets(asset);
            this.pbkhAssets = splittedAssets;
        }
    };

    public create100Mints = async () => {
        const assetOwnerKey = await this.keyStore.asset.createKey();
        this.assetOwner = AssetAddress.fromTypeAndPayload(1, assetOwnerKey, {
            networkId
        });
        {
            await this.mint100Assets();
        }
    };

    public popPBKHAsset = (): Asset => {
        const asset = this.pbkhAssets.pop();
        assert.isDefined(asset);
        return asset as Asset;
    };

    public mint100Assets = async (): Promise<void> => {
        const txHashes = [];
        const seq = await getCurrentSeq(this.sdk, faucetAddress);
        for (let index = 0; index < 100; index++) {
            const assetScheme = this.sdk.core.createAssetScheme({
                shardId: 0,
                metadata: JSON.stringify({
                    name: `Gold For Performance Test ${Math.random()}`,
                    description: `An asset to test performance ${Math.random()}`,
                    icon_url: "https://static.majecty.tech/images/clock512.png"
                }),
                supply: 100
            });

            const transaction = this.sdk.core.createMintAssetTransaction({
                scheme: assetScheme,
                recipient: this.assetOwner!
            });

            const signedTransaction = await this.sdk.key.signTransaction(
                transaction,
                {
                    account: faucetAddress,
                    fee: 100_000,
                    seq: seq + index
                }
            );

            const txHash = await this.sdk.rpc.chain.sendSignedTransaction(
                signedTransaction
            );
            txHashes.push(txHash);
        }

        for (const txHash of txHashes) {
            await waitContainTransacitonSuccess(
                this.sdk,
                txHash,
                TRANSACTION_TIMEOUT
            );
        }
    };

    private mintAsset = async (): Promise<Asset> => {
        const assetScheme = this.sdk.core.createAssetScheme({
            shardId: 0,
            metadata: JSON.stringify({
                name: "Gold For Performance Test",
                description: `An asset to test performance ${Math.random()}`,
                icon_url: "https://static.majecty.tech/images/clock512.png"
            }),
            supply: 100
        });

        const transaction = this.sdk.core.createMintAssetTransaction({
            scheme: assetScheme,
            recipient: this.assetOwner!
        });

        const signedTransaction = await this.sdk.key.signTransaction(
            transaction,
            {
                account: faucetAddress,
                fee: 100_000,
                seq: await getCurrentSeq(this.sdk, faucetAddress)
            }
        );

        const minedTransaction = await this.sdk.rpc.chain.sendSignedTransaction(
            signedTransaction
        );

        await waitContainTransacitonSuccess(
            this.sdk,
            minedTransaction,
            TRANSACTION_TIMEOUT
        );

        return transaction.getMintedAsset();
    };

    private splitToPBKHAssets = async (asset: Asset): Promise<Asset[]> => {
        const outputs = _.range(0, 100).map(() => ({
            recipient: this.assetOwner!,
            quantity: 1,
            assetType: asset.assetType,
            shardId: asset.shardId
        }));
        const transaction = this.sdk.core
            .createTransferAssetTransaction()
            .addInputs(asset)
            .addOutputs(outputs);

        await this.sdk.key.signTransactionInput(transaction, 0, {
            keyStore: this.keyStore
        });

        const signedTransaction = await this.sdk.key.signTransaction(
            transaction,
            {
                account: faucetAddress,
                fee: 100,
                seq: await getCurrentSeq(this.sdk, faucetAddress)
            }
        );

        const txHash = await this.sdk.rpc.chain.sendSignedTransaction(
            signedTransaction
        );

        await waitContainTransacitonSuccess(
            this.sdk,
            txHash,
            TRANSACTION_TIMEOUT
        );

        return transaction.getTransferredAssets();
    };
}
