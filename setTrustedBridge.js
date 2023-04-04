const { Level } = require('level');
const db_tokenInfos = new Level("tokenInfos");

const setTrustedBridge = async (ids) => {
    for (var i = 0; i < ids.length; i++) {
        const id = "trust:" + ids[i]
        await db_tokenInfos.put(id, true);
    }
}

const removeTrustedBridge = async (ids) => {
    for (var i = 0; i < ids.length; i++) {
        const id = "trust:" + ids[i]
        await db_tokenInfos.put(id, false);
    }
}

async function main() {
    await setTrustedBridge([
        "0x7fa4b6f62ff79352877b3411ed4101c394a711d5:zz-token-bridge"
    ]);
}

main();