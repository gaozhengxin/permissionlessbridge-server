const jayson = require('jayson');
const { ethers } = require("ethers");

const { Level } = require('level');
const db_tokenInfos = new Level("tokenInfos");

// create a server
const server = new jayson.Server({
    fax_getTokenInfo: (args, callback) => {
        db_tokenInfos.get(args[0], { asBuffer: false }, (e, res) => {
            callback(null, JSON.parse(res));
        });
    },
    fax_submitTokenInfo: async (args, callback) => {
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
            for (const chainID in args[0].configs) {
                const element = args[0].configs[chainID];
                tokenInfo.configs[chainID] = {
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

            console.log(`payload : ${JSON.stringify(tokenInfo)}`);

            var res = ethers.verifyMessage(JSON.stringify(tokenInfo), args[0].signature);
            console.log(`res : ${res}`);
            if (res !== deployer) {
                callback(null, "fail to verify signature");
                return;
            }

            await db_tokenInfos.put(id, JSON.stringify(tokenInfo));
            callback(null, id);
        }
    }
});

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