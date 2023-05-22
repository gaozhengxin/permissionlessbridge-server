const jayson = require('jayson');
const { ethers, AbiCoder } = require("ethers");

const { Level } = require('level');
const db_tokenInfos = new Level("tokenInfos");
const db_trustedBridges = new Level("trustedBridges");
const db_lpCache = new Level("lpCache");

//const trustedGatewayCodeHash = new Map();
//trustedGatewayCodeHash.set("0x2a81d1cd005c72ef885fb17449d1067fb1136d38ddfea365e7efd3f452b3b423", 1); // gateway mint burn v1
//trustedGatewayCodeHash.set("0x823698c71e40c852f7484c667be7c7d78c8818ae0daf844650fc5f287bff560c", 1); // gateway pool v1

//const trustedTokenCodeHash = new Map();
//trustedTokenCodeHash.set("0x149371ad26463543075824dfabdff189653d9496348d4a029b52395c5f08d4de", 1); // bridge token

var providers = {}

const cacheTimeout = 600000;
//const cacheTimeout = 0;
const rpcTimeout = 15000;

const initProvider = async (chainId, url) => {
    console.log(`chainid : ${chainId}, url : ${url}`);
    for (; true;) {
        try {
            //providers[chainId] = new ethers.JsonRpcProvider(url);
            const provider = new ethers.JsonRpcProvider(url);
            return provider;
        } catch (error) {
            console.warn(`create provider error : ${JSON.stringify({ chainid: chainId, error: error })}`);
            await new Promise(resolve => setTimeout(resolve, rpcTimeout));
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

const multicall = {
    5: "0x84e9a6F9D240FdD33801f7135908BfA16866939A",
    97: "0x4BfBe41c39481747D3a98C5bee320bE5F3C9fd70",
    4002: "0x6E3bF2fFf13e18413D3780f93753D6CFf5AEE3e1",
    1287: "0x5fC17416925789E0852FBFcd81c490ca4abc51F9",
    43113: "0xf27Ee99622C3C9b264583dACB2cCE056e194494f",
    420: "0x922D641a426DcFFaeF11680e5358F34d97d112E1",
    421613: "0x7C598c96D02398d89FbCb9d41Eab3DF0C16F227D",
};

const admin = "0x7fa4b6F62fF79352877B3411Ed4101C394a711D5";

/*
1. create ethers rpc provider
2. get gateway balance
*/

const fax_getTokenInfos = async (args, callback) => {
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
            let parsed = JSON.parse(value)
            if (parsed.delisted === true) {
                continue;
            }
            var tokenInfo = formatTokenInfo(parsed);

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
        var promises = []
        if (checkStatus) {
            var calls = {};
            for (var i = 0; i < tokenInfos.length; i++) {
                for (var j = 0; j < tokenInfos[i].configs.length; j++) {
                    if (tokenInfos[i].configs[j].type == "pool") {
                        // check balance
                        const calldata = "0x70a08231000000000000000000000000" + tokenInfos[i].configs[j].gateway.toLowerCase().replace("0x", "");
                        try {
                            const key_lpCache = (tokenInfos[i].configs[j].chainId + ":" + tokenInfos[i].configs[j].token + ":" + tokenInfos[i].configs[j].gateway).toLowerCase();
                            console.log(`key_lpCache : ${key_lpCache}`);
                            try {
                                const bal_cache = await db_lpCache.get(key_lpCache);
                                const bal_cache_obj = JSON.parse(bal_cache);
                                if (bal_cache_obj.timestamp !== undefined && bal_cache_obj.timestamp >= Date.now() - cacheTimeout) {
                                    console.log(`use cache bal : ${JSON.stringify(bal_cache_obj)}`);
                                    tokenInfos[i].configs[j].liquidity = bal_cache_obj.value;
                                    break;
                                }
                            } catch (error) {
                            }
                            if (providers[tokenInfos[i].configs[j].chainId] !== undefined && providers[tokenInfos[i].configs[j].chainId] !== null) {
                                if (calls[tokenInfos[i].configs[j].chainId] == undefined) {
                                    calls[tokenInfos[i].configs[j].chainId] = [];
                                }
                                calls[tokenInfos[i].configs[j].chainId].push({
                                    token: tokenInfos[i].configs[j].token,
                                    gateway: tokenInfos[i].configs[j].gateway,
                                    bridgeIdx: i,
                                    gatewayIdx: j,
                                    calldata: calldata
                                });
                                tokenInfos[i].configs[j].liquidity = "";
                            } else {
                                tokenInfos[i].configs[j].liquidity = JSON.stringify({ error: {} });
                            }
                        } catch (error) {
                            tokenInfos[i].configs[j].liquidity = JSON.stringify({ error: error });
                        }
                    }
                }
            }
            console.log(`calls : ${JSON.stringify(calls)}`);
            var batches = {};
            const batchSize = 50;
            for (const key in calls) {
                console.log(`calls : ${JSON.stringify(calls[key])}`);
                var k = 0;
                for (var i = 0; i < calls[key].length; i++) {
                    const batchKey = key + ":" + Math.floor(k / batchSize);
                    if (batches[batchKey] == undefined) {
                        batches[batchKey] = { chainId: key, batchLength: 0 };
                    }
                    batches[batchKey][i] = calls[key][i];
                    batches[batchKey].batchLength = k % batchSize + 1;
                    k++;
                }
            }
            console.log(`batches : ${JSON.stringify(batches)}`);
            var aggregateCalls = [];
            for (const key in batches) {
                let promise = (async () => {
                    console.log(`handle batch : ${key}`);
                    for (var i = 0; i < batches[key].batchLength; i++) {
                        tokenInfos[batches[key][i + ""].bridgeIdx].configs[batches[key][i + ""].gatewayIdx].liquidity = "fetch liquidity timeout";
                        aggregateCalls.push([batches[key][i + ""].token, batches[key][i + ""].calldata]);
                    }

                    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
                    var multicalldata = abiCoder.encode(["tuple(address, bytes)[]"], [aggregateCalls]);
                    multicalldata = "0x252dba42" + multicalldata.replace("0x", "");

                    let multicallres = await providers[batches[key].chainId].call({ to: multicall[batches[key].chainId], data: multicalldata, gasLimit: 100000 });
                    //let multicallres = "0x0000000000000000000000000000000000000000000000000000000001c2f57e00000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000";
                    console.log(`multicall res : ${multicallres}`);
                    let decodedRes = abiCoder.decode(["uint256", "bytes[]"], multicallres);
                    console.log(`decodedRes : ${decodedRes}`);
                    if (decodedRes.length !== 2 || decodedRes[1] === null || decodedRes[1] === undefined || decodedRes[1].length === 0) {
                        return;
                    }
                    for (var i = 0; i < decodedRes[1].length; i++) {
                        let bal = parseInt(decodedRes[1][i], 16).toString()
                        const bridgeIdx = batches[key][i + ""].bridgeIdx;
                        const gatewayIdx = batches[key][i + ""].gatewayIdx;
                        tokenInfos[bridgeIdx].configs[gatewayIdx].liquidity = bal;

                        const bal_cache_obj = { timestamp: Date.now(), value: bal };
                        const key_lpCache = (tokenInfos[bridgeIdx].configs[gatewayIdx].chainId + ":" + tokenInfos[bridgeIdx].configs[gatewayIdx].token + ":" + tokenInfos[bridgeIdx].configs[gatewayIdx].gateway).toLowerCase();
                        console.log(`put cache obj : ${JSON.stringify(bal_cache_obj)}`);
                        await db_lpCache.put(key_lpCache, JSON.stringify(bal_cache_obj));
                        //const bal_cache_retrieve = await db_lpCache.get(key_lpCache);
                        //console.log(`retrieve cache obj : ${bal_cache_retrieve}`);
                    }
                })();
                promises.push(promise);
            }
        }
        if (promises.length > 0) {
            let promise1 = new Promise(resolve => setTimeout(resolve, rpcTimeout));
            let promise2 = Promise.all(promises);
            await Promise.any([promise1, promise2]);
        }
        callback(null, tokenInfos);
    } catch (error) {
        console.log(error);
        callback(null, JSON.stringify(error));
    }
};

const fax_getBridgeList = async (args, callback) => {
    var keys = [];
    for await (const [key, value] of db_tokenInfos.iterator({})) {
        keys.push(key);
    }
    callback(null, keys);
};

const fax_getAllTokenInfos = async (args, callback) => {
    var checkStatus = false;
    if (args.length > 0 && args[0] == true) {
        checkStatus = true;
    }
    fax_getBridgeList([], (res, keys) => {
        if (res == null && keys.length > 0) {
            const args1 = [].concat([checkStatus], keys);
            fax_getTokenInfos(args1, callback);
        }
    });
};

// create a server
const server = new jayson.Server({
    fax_setTrustedGateway: (args, callback) => { },
    fax_setTrustedToken: (args, callback) => { },
    fax_getTokenInfo: async (args, callback) => {
        try {
            const id = args[0];
            db_tokenInfos.get(id, { asBuffer: false }, async (e, res) => {
                try {
                    let parsed = JSON.parse(value)
                    if (parsed.delisted === true) {
                        callback(null, null);
                    }
                    var tokenInfo = formatTokenInfo(parsed);
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
    fax_getTokenInfos: fax_getTokenInfos,
    fax_getAllTokenInfos: fax_getAllTokenInfos,
    fax_getBridgeList: fax_getBridgeList,
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
    },
    fax_delistBridge: async (args, callback) => {
        var id = args[0].id;
        let arr = id.split(":");
        if (arr.length < 2) {
            callback(null, "invalid id");
            return;
        }
        id = arr[0].toLowerCase();
        for (var i = 1; i < arr.length; i++) {
            id = id.concat(":").concat(arr[i]);
        }
        const signature = args[0].signature;
        const expire = args[0].expire; // s
        if (expire * 1000 < Date.now()) {
            callback(null, "signature expired");
        }
        db_tokenInfos.get(id, { asBuffer: false }, async (e, res) => {
            try {
                var tokenInfo = formatTokenInfo(JSON.parse(res));
                const payload = {
                    deployer: tokenInfo.deployer,
                    message: "delist bridge " + id,
                    expire: expire
                }
                var res = ethers.verifyMessage(JSON.stringify(payload), signature);
                console.log(`payload : ${JSON.stringify(payload)}`);
                if (res !== tokenInfo.deployer) {
                    callback(null, "fail to verify signature");
                    return;
                }
                tokenInfo.delisted = true;
                await db_tokenInfos.put(id, JSON.stringify(tokenInfo));
                callback(null, true);
            } catch (error) {
                callback(null, JSON.stringify(error));
            }
        });
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

server.http().listen(3131);