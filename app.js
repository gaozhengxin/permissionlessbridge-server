const jayson = require('jayson');
const { ethers } = require("ethers");

const { Level } = require('level');
const db_tokenInfos = new Level("tokenInfos");
const db_trustedBridges = new Level("trustedBridges");

//const trustedGatewayCodeHash = new Map();
//trustedGatewayCodeHash.set("0x2a81d1cd005c72ef885fb17449d1067fb1136d38ddfea365e7efd3f452b3b423", 1); // gateway mint burn v1
//trustedGatewayCodeHash.set("0x823698c71e40c852f7484c667be7c7d78c8818ae0daf844650fc5f287bff560c", 1); // gateway pool v1

//const trustedTokenCodeHash = new Map();
//trustedTokenCodeHash.set("0x149371ad26463543075824dfabdff189653d9496348d4a029b52395c5f08d4de", 1); // bridge token

var providers = {}

const initProvider = async (chainId, url) => {
    console.log(`chainid : ${chainId}, url : ${url}`);
    for (; true;) {
        try {
            //providers[chainId] = new ethers.JsonRpcProvider(url);
            const provider = new ethers.JsonRpcProvider(url);
            return provider;
        } catch (error) {
            console.warn(`create provider error : ${JSON.stringify({ chainid: chainId, error: error })}`);
            await new Promise(resolve => setTimeout(resolve, 5000));
            continue;
        }

    }
}

const initProviders = async () => {
    (async () => { providers["5"] = await initProvider("5", "https://rpc.ankr.com/eth_goerli"); })();
    (async () => { providers["97"] = await initProvider("97", "https://rpc.ankr.com/bsc_testnet_chapel"); })();
    (async () => { providers["4002"] = await initProvider("4002", "https://rpc.ankr.com/fantom_testnet"); })();
    (async () => { providers["1287"] = await initProvider("1287", "https://rpc.api.moonbase.moonbeam.network"); })();
    (async () => { providers["43113"] = await initProvider("43113", "https://rpc.ankr.com/avalanche_fuji"); })();
    (async () => { providers["420"] = await initProvider("420", "https://optimism-goerli.public.blastapi.io"); })();
    (async () => { providers["421613"] = await initProvider("421613", "https://goerli-rollup.arbitrum.io/rpc"); })();
}

initProviders();

const admin = "0x7fa4b6F62fF79352877B3411Ed4101C394a711D5";

/*
1. create ethers rpc provider
2. get gateway balance
*/

// create a server
const server = new jayson.Server({
    fax_setTrustedGateway: (args, callback) => { },
    fax_setTrustedToken: (args, callback) => { },
    fax_getTokenInfo: async (args, callback) => {
        try {
            const id = args[0];
            db_tokenInfos.get(id, { asBuffer: false }, async (e, res) => {
                try {
                    var tokenInfo = formatTokenInfo(JSON.parse(res));
                    //var tokenInfo = await checkTrustedAddresses(JSON.parse(res));
                    tokenInfo.verified = 0;
                    try {
                        const isTrusted = await db_tokenInfos.get("trust:" + id);
                        if (isTrusted) {
                            tokenInfo.verified = 1;
                        } else {
                            tokenInfo.verified = 0;
                        }
                    } catch (error) {
                        tokenInfo.verified = 0;
                    }
                    for (var i = 0; i < tokenInfo.configs.length; i++) {
                        tokenInfo.configs[i].maxTxAmount = "";
                    }
                    callback(null, tokenInfo);
                } catch (error) {
                    callback(null, JSON.stringify(error));
                }

            });
        } catch (error) {
            callback(null, JSON.stringify(error));
        }
    },
    fax_getTokenInfos: async (args, callback) => {
        var checkStatus = false;
        switch (args[0]) {
            case true:
                checkStatus = true;
            case "true":
                checkStatus = true;
            default:
        }
        try {
            var tokenInfos = [];
            for await (const id of args) {
                if (id === true || id === "true" || id === false || id === "false") {
                    continue;
                }

                const value = await db_tokenInfos.get(id);
                var tokenInfo = formatTokenInfo(JSON.parse(value));

                try {
                    const isTrusted = await db_trustedBridges.get("trust:" + id);
                    if (isTrusted) {
                        tokenInfo.verified = 1;
                    } else {
                        tokenInfo.verified = 0;
                    }
                } catch (error) {
                    tokenInfo.verified = 0;
                }
                for (var i = 0; i < tokenInfo.configs.length; i++) {
                    tokenInfo.configs[i].maxTxAmount = "";
                }
                tokenInfos.push(tokenInfo);
            }
            if (checkStatus) {
                for (var i = 0; i < tokenInfos.length; i++) {
                    for (var j = 0; j < tokenInfos[i].configs.length; j++) {
                        if (tokenInfos[i].configs[j].type == "pool") {
                            // check balance
                            const calldata = "0x70a08231000000000000000000000000" + tokenInfos[i].configs[j].gateway.toLowerCase().replace("0x", "");
                            try {
                                if (providers[tokenInfos[i].configs[j].chainId] !== undefined && providers[tokenInfos[i].configs[j].chainId] !== null) {
                                    let bal = await providers[tokenInfos[i].configs[j].chainId].call({ to: tokenInfos[i].configs[j].token, data: calldata });
                                    tokenInfos[i].configs[j].liquidity = parseInt(bal, 16).toString();
                                } else {
                                    tokenInfos[i].configs[j].liquidity = JSON.stringify({ error: {} });
                                }
                            } catch (error) {
                                tokenInfos[i].configs[j].liquidity = JSON.stringify({ error: error });
                            }
                        }
                    }
                }
            }
            callback(null, tokenInfos);
        } catch (error) {
            callback(null, JSON.stringify(error));
        }
    },
    fax_getBridgeList: async (args, callback) => {
        var keys = [];
        for await (const [key, value] of db_tokenInfos.iterator({})) {
            keys.push(key);
        }
        callback(null, keys);
    },
    fax_submitTokenInfo: async (args, callback) => {
        try {
            var deployer = ethers.getAddress(args[0].deployer);
            var id = deployer.toString().toLowerCase() + ":" + args[0].projectName;
            if (containsSpecialChars(id)) {
                callback(null, "invalid character");
            } else {
                var tokenInfo = {
                    deployer: deployer,
                    projectName: args[0].projectName,
                    configs: {}
                };
                for (var i = 0; i < args[0].configs.length; i++) {
                    const element = args[0].configs[i];
                    const chainid = args[0].configs[i].chainId;
                    tokenInfo.configs["" + chainid] = {
                        type: element.type !== null ? element.type : "",
                        logo: element.logo !== null ? element.logo : "",
                        token: element.token !== null ? element.token : "",

                        name: element.name !== null ? element.name : "",
                        symbol: element.symbol !== null ? element.symbol : "",
                        decimals: element.decimals !== null ? element.decimals : null,

                        gateway: element.gateway !== null ? element.gateway : "",
                    }
                }

                tokenInfo.configs = Object.keys(tokenInfo.configs).sort().reduce(
                    (obj, key) => {
                        obj[key] = tokenInfo.configs[key];
                        return obj;
                    },
                    {}
                );

                var payload = {
                    deployer: tokenInfo.deployer,
                    projectName: tokenInfo.projectName,
                    configs: args[0].configs
                }
                //var payload = formatTokenInfo(tokenInfo);
                console.log(`payload: ${JSON.stringify(payload)} `);

                var res = ethers.verifyMessage(JSON.stringify(payload), args[0].signature);
                console.log(`res: ${res} `);
                if (res !== deployer) {
                    callback(null, "fail to verify signature");
                    return;
                }

                await db_tokenInfos.put(id, JSON.stringify(tokenInfo));
                callback(null, id);
            }
        } catch (error) {
            callback(null, JSON.stringify(error));
        }
    }
});

const formatTokenInfo = (tokenInfo1) => {
    if (tokenInfo1 === null || tokenInfo1 === undefined) {
        return "not found";
    }
    var tokenInfo = {
        deployer: tokenInfo1.deployer,
        projectName: tokenInfo1.projectName,
        configs: [],
    };
    for (const chainID in tokenInfo1.configs) {
        tokenInfo.configs.push({
            type: tokenInfo1.configs[chainID].type,
            chainId: chainID,
            logo: tokenInfo1.configs[chainID].logo,
            token: tokenInfo1.configs[chainID].token,
            name: tokenInfo1.configs[chainID].name,
            symbol: tokenInfo1.configs[chainID].symbol,
            decimals: tokenInfo1.configs[chainID].decimals,
            gateway: tokenInfo1.configs[chainID].gateway,
        });
    }
    return tokenInfo;
}

const checkTrustedAddresses = async (tokenInfo) => {
    for (const key in tokenInfo.configs) {
        console.log(`key: ${key} `);
        //var trustedGateway = await isStandardGateway(key, tokenInfo.configs[key].gateway);
        //var trustedToken = await isStandardBridgeToken(key, tokenInfo.configs[key].token);
        console.log(`trustedGateway: ${trustedGateway} `);
        console.log(`trustedToken: ${trustedToken} `);
        if (trustedGateway && trustedToken) {
            tokenInfo.configs[key].isTrustedGateway = true;
            tokenInfo.configs[key].isTrustedBridgeToken = true;
        } else if (trustedGateway) {
            tokenInfo.configs[key].isTrustedGateway = true;
            tokenInfo.configs[key].isTrustedBridgeToken = false;
        } else if (trustedToken) {
            tokenInfo.configs[key].isTrustedGateway = false;
            tokenInfo.configs[key].isTrustedBridgeToken = true;
        } else {
            tokenInfo.configs[key].isTrustedGateway = false;
            tokenInfo.configs[key].isTrustedBridgeToken = false;
        }
    }

    return tokenInfo;
}

const isStandardGateway = async (chainid, gateway) => {
    return true;
    //let code = await providers[chainid].getCode(gateway);
    //const hash = ethers.keccak256(code);
    //return (trustedGatewayCodeHash[hash] === 1);
}

const isStandardBridgeToken = async (chainid, token) => {
    return true;
    //let code = await providers[chainid].getCode(token);
    //const hash = ethers.keccak256(code);
    //return (trustedTokenCodeHash[hash] === 1);
}

function containsSpecialChars(str) {
    const specialChars = `\`!@#$%^&*()_+=\[\]{};'"\\|,.<>\/?~`;

    const result = specialChars.split('').some(specialChar => {
        if (str.includes(specialChar)) {
            return true;
        }

        return false;
    });

    return result;
}

server.http().listen(3000);