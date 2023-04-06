const { Level } = require('level');
const db_trustedBridges = new Level("trustedBridges");

const setTrustedBridge = async (ids) => {
    for (var i = 0; i < ids.length; i++) {
        const id = "trust:" + ids[i]
        await db_trustedBridges.put(id, true);
    }
}

const removeTrustedBridge = async (ids) => {
    for (var i = 0; i < ids.length; i++) {
        const id = "trust:" + ids[i]
        await db_trustedBridges.put(id, false);
    }
}

async function main() {
    await setTrustedBridge([
        "0x9c3d7ab444055dcd652ff418c0f12032f72edb0e:Crypto fax"
    ]);
}

main();