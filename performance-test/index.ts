import CodeChain from "./src/codeChain";

async function main() {
    const codeChain = new CodeChain();

    await codeChain.create100UTXOs();
}

main()
    .then(() => console.log("finish"))
    .catch(err => console.error(err));
