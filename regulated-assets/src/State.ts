import {
    AssetAddress,
    H160,
    H160Value,
    PlatformAddress,
    PlatformAddressValue,
    U64,
    U64Value,
} from "codechain-primitives";
import { Asset, AssetScheme } from "codechain-sdk/lib/core/classes";
import * as request from "request-promise-native";

import { CreateAsset } from "./actions/CreateAsset";
import { INDEXER_URL, REGULATOR, REGULATOR_ALT, sdk } from "./configs";
import { assert, AssetSummarization } from "./util";
import { P2PKH } from "codechain-sdk/lib/key/P2PKH";
import { P2PKHBurn } from "codechain-sdk/lib/key/P2PKHBurn";

export type LockScriptType = "P2PKH" | "P2PKHBurn";

export class Utxo {
    public owner: H160;
    public asset: Asset;

    public constructor(owner: H160, asset: Asset) {
        this.owner = owner;
        this.asset = asset;
    }
}

export class State {
    private balances: { [account: string]: U64 };
    private seqs: { [account: string]: number };
    private utxos: { [accountId: string]: Utxo[] };
    private assetSchemes: { [assetType: string]: AssetScheme };

    public constructor() {
        this.balances = {};
        this.seqs = {};
        this.utxos = {};
        this.assetSchemes = {};
    }

    public async recover(
        addresses: PlatformAddress[],
        accounts: H160[],
        assetSchemes?: AssetScheme[],
    ) {
        console.log("state recovey");

        const cccs = await Promise.all(addresses.map(address => sdk.rpc.chain.getBalance(address)));
        const seqs = await Promise.all(addresses.map(address => sdk.rpc.chain.getSeq(address)));

        for (const assetScheme of assetSchemes || []) {
            const assetType = new CreateAsset({
                regulator: REGULATOR.platformAddress,
                recipient: REGULATOR.accountId,
                assetScheme,
            }).tx.getAssetType();
            const currentAssetScheme = await sdk.rpc.chain.getAssetSchemeByType(assetType, 0);
            if (!currentAssetScheme) {
                continue;
            }
            this.assetSchemes[assetType.value] = currentAssetScheme;
            console.log(currentAssetScheme.toJSON());
        }

        for (let i = 0; i < addresses.length; i++) {
            const address = addresses[i];

            this.modifyBalance(address, () => cccs[i]);
            console.log(`balance ${address}: ${this.getBalance(address).toString(10)}`);

            this.setSeq(address, seqs[i]);
            console.log(`seq ${address}: ${this.getSeq(address)}`);
        }

        for (const account of accounts) {
            this.utxos[account.value] = [];
            for (const assetType of Object.keys(this.assetSchemes)) {
                interface UtxoAttribute {
                    id?: string;
                    address: string;
                    assetType: string;
                    shardId: number;
                    lockScriptHash: string;
                    parameters: string[];
                    quantity: string;
                    orderHash?: string | null;
                    transactionHash: string;
                    transactionTracker: string;
                    transactionOutputIndex: number;
                }
                const assetAddress = AssetAddress.fromTypeAndPayload(1, account, {
                    networkId: sdk.networkId,
                });
                const utxoResponse: UtxoAttribute[] = [];
                for (let page = 1; ; page++) {
                    const result: UtxoAttribute[] = await request({
                        url: `${INDEXER_URL}/api/utxo?address=${
                            assetAddress.value
                        }&assetType=${assetType}&page=${page}`,
                        json: true,
                    });
                    if (result.length === 0) break;
                    utxoResponse.push(...result);
                }
                const utxos = utxoResponse.map(utxo => {
                    const asset = Asset.fromJSON({
                        assetType: utxo.assetType,
                        lockScriptHash: utxo.lockScriptHash,
                        parameters: utxo.parameters,
                        quantity: utxo.quantity,
                        orderHash: utxo.orderHash || null,
                        shardId: utxo.shardId,
                        tracker: utxo.transactionTracker,
                        transactionOutputIndex: utxo.transactionOutputIndex,
                    });
                    if (
                        !asset.lockScriptHash.isEqualTo(P2PKH.getLockScriptHash()) &&
                        !asset.lockScriptHash.isEqualTo(P2PKHBurn.getLockScriptHash())
                    ) {
                        console.error({
                            "asset.lockScriptHash": asset.lockScriptHash,
                            P2PKH: P2PKH.getLockScriptHash(),
                            P2PKHBurn: P2PKHBurn.getLockScriptHash(),
                        });
                        throw Error("Unrecognizable lockScriptHash");
                    }
                    return new Utxo(account, asset);
                });
                this.utxos[account.value].push(...utxos);
            }
            this.printUtxos(account);
        }
    }

    public getBalance(addressValue: PlatformAddressValue): U64 {
        const address = PlatformAddress.ensure(addressValue);
        if (this.balances.hasOwnProperty(address.value)) {
            return this.balances[address.value];
        } else {
            return new U64(0);
        }
    }

    public setBalance(addressValue: PlatformAddressValue, value: U64Value) {
        const address = PlatformAddress.ensure(addressValue);
        this.balances[address.value] = U64.ensure(value);
    }

    public modifyBalance(
        addressValue: PlatformAddressValue,
        callback: (balance: U64) => U64Value,
    ): U64 {
        const existing = this.getBalance(addressValue);
        const result = U64.ensure(callback(existing));
        this.setBalance(addressValue, result);
        return existing;
    }

    public getUtxos(accountValue: H160Value): Utxo[] {
        const address = H160.ensure(accountValue);
        if (this.utxos.hasOwnProperty(address.value)) {
            return this.utxos[address.value];
        } else {
            const utxos: Utxo[] = [];
            this.utxos[address.value] = utxos;
            return utxos;
        }
    }

    public printUtxos(...accountValues: H160Value[]) {
        function compareU64(a: U64, b: U64): number {
            if (a.isGreaterThan(b)) {
                return -1;
            } else if (b.isGreaterThan(a)) {
                return 1;
            } else {
                return 0;
            }
        }

        for (const regulator of [REGULATOR, REGULATOR_ALT]) {
            const assetTypes = this.allAssetSchemes()
                .filter(([_, as]) => as.registrar!.value === regulator.platformAddress.value)
                .map(([assetType, _]) => assetType);
            if (assetTypes.length > 0) {
                console.group(`registrar: ${regulator.platformAddress.value}`);
                for (const assetType of assetTypes) {
                    console.log(`owns: ${assetType}`);
                }
                console.groupEnd();
            }
        }
        for (const accountValue of accountValues) {
            const utxos = this.getUtxos(accountValue).map(utxo => utxo.asset);
            if (utxos.length === 0) {
                continue;
            }
            const assetTypes = new Set(utxos.map(utxo => utxo.assetType.value));

            const p2pkhHash = P2PKH.getLockScriptHash();
            const p2pkhBurnHash = P2PKHBurn.getLockScriptHash();
            const p2pkhBin = AssetSummarization.summerize(
                utxos.filter(utxo => utxo.lockScriptHash.isEqualTo(p2pkhHash)),
            );
            const p2pkhBurnsBin = AssetSummarization.summerize(
                utxos.filter(utxo => utxo.lockScriptHash.isEqualTo(p2pkhBurnHash)),
            );

            console.group(`utxo for ${H160.ensure(accountValue).value}`);
            for (const assetType of [...assetTypes].sort()) {
                const p2pkhs = p2pkhBin
                    .get(assetType)
                    .values.map(x => x.quantity)
                    .sort(compareU64)
                    .map(quantity => quantity.toString(10))
                    .join(", ");
                const p2pkhBurns = p2pkhBurnsBin
                    .get(assetType)
                    .values.map(x => x.quantity)
                    .sort(compareU64)
                    .map(quantity => quantity.toString(10))
                    .join(", ");
                console.log(`utxo ${assetType}: [${p2pkhs}], burns: [${p2pkhBurns}]`);
            }
            console.groupEnd();
        }
    }

    public hasAssetScheme(assetTypeValue: H160Value): boolean {
        const assetType = H160.ensure(assetTypeValue);
        return this.assetSchemes.hasOwnProperty(assetType.value);
    }

    public getAssetScheme(assetTypeValue: H160Value): AssetScheme {
        const assetType = H160.ensure(assetTypeValue);
        return this.assetSchemes[assetType.value];
    }

    public setAssetScheme(assetTypeValue: H160Value, assetScheme: AssetScheme) {
        const assetType = H160.ensure(assetTypeValue);
        assert(() => !this.hasAssetScheme(assetType));
        this.assetSchemes[assetType.value] = assetScheme;
    }

    public allAssetSchemes(): [H160, AssetScheme][] {
        const result: [H160, AssetScheme][] = [];
        for (const assetType of Object.keys(this.assetSchemes)) {
            result.push([H160.ensure(assetType), this.assetSchemes[assetType]]);
        }
        return result;
    }

    public getSeq(addressValue: PlatformAddressValue): number {
        return this.seqs[PlatformAddress.ensure(addressValue).value];
    }

    public nextSeq(addressValue: PlatformAddressValue): number {
        return this.seqs[PlatformAddress.ensure(addressValue).value]++;
    }

    private setSeq(addressValue: PlatformAddressValue, seq: number) {
        this.seqs[PlatformAddress.ensure(addressValue).value] = seq;
    }
}
