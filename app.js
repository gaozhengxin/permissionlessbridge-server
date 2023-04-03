const jayson = require('jayson');
const { ethers } = require("ethers");

const { Level } = require('level');
const db_tokenInfos = new Level("tokenInfos");

const trustedGatewayCodeHash = new Map();
trustedGatewayCodeHash.set("0x2a81d1cd005c72ef885fb17449d1067fb1136d38ddfea365e7efd3f452b3b423", 1); // gateway mint burn v1
trustedGatewayCodeHash.set("0x823698c71e40c852f7484c667be7c7d78c8818ae0daf844650fc5f287bff560c", 1); // gateway pool v1

const trustedTokenCodeHash = new Map();
trustedTokenCodeHash.set("0x149371ad26463543075824dfabdff189653d9496348d4a029b52395c5f08d4de", 1); // bridge token

var providers = {}
providers["5"] = new ethers.JsonRpcProvider("https://rpc.ankr.com/eth_goerli");
providers["97"] = new ethers.JsonRpcProvider("https://rpc.ankr.com/bsc_testnet_chapel");
providers["4002"] = new ethers.JsonRpcProvider("https://rpc.ankr.com/fantom_testnet");


const checkChainIDs = async () => {
    Object.keys(providers).forEach(async (key) => {
        const { chainId } = await providers[key].getNetwork()
        console.log(`chain id : ${chainId}`);
    });
};

checkChainIDs();

const admin = "0x7fa4b6F62fF79352877B3411Ed4101C394a711D5";

// create a server
const server = new jayson.Server({
    fax_setTrustedGateway: (args, callback) => { },
    fax_setTrustedToken: (args, callback) => { },
    fax_getTokenInfo: (args, callback) => {
        try {
            const id = args[0];
            console.log(`id : ${id}`);
            db_tokenInfos.get(id, { asBuffer: false }, async (e, res) => {
                var tokenInfo = formatTokenInfo(JSON.parse(res));
                //var tokenInfo = await checkTrustedAddresses(JSON.parse(res));
                console.log(JSON.stringify(tokenInfo));

                callback(null, tokenInfo);


            });
        } catch (error) {
            callback(null, JSON.stringify(error));
        }
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

                var payload = formatTokenInfo(tokenInfo);
                console.log(`payload : ${JSON.stringify(payload)}`);

                var res = ethers.verifyMessage(JSON.stringify(payload), args[0].signature);
                console.log(`res : ${res}`);
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
        console.log(`key : ${key}`);
        var trustedGateway = await isStandardGateway(key, tokenInfo.configs[key].gateway);
        var trustedToken = await isStandardBridgeToken(key, tokenInfo.configs[key].token);
        console.log(`trustedGateway : ${trustedGateway}`);
        console.log(`trustedToken : ${trustedToken}`);
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
    let code = await providers[chainid].getCode(gateway);
    const hash = ethers.keccak256(code);
    return true;
    console.log(hash);
    console.log(trustedGatewayCodeHash[hash]);
    console.log(trustedGatewayCodeHash[hash] === 1);
    return (trustedGatewayCodeHash[hash] === 1);
}

const isStandardBridgeToken = async (chainid, token) => {
    let code = await providers[chainid].getCode(token);
    const hash = ethers.keccak256(code);
    return true;
    console.log(hash);
    console.log(trustedTokenCodeHash[JSON.stringify(hash)]);
    console.log(trustedTokenCodeHash[hash] === 1);
    return (trustedTokenCodeHash[hash] === 1);
}

function containsSpecialChars(str) {
    const specialChars = `\ \`!@#$%^&*()_+=\[\]{};'"\\|,.<>\/?~`;

    const result = specialChars.split('').some(specialChar => {
        if (str.includes(specialChar)) {
            return true;
        }

        return false;
    });

    return result;
}

server.http().listen(3000);