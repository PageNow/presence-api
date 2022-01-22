async function getPublicKeys() {
    return { };
}

async function decodeVerifyJwt(authObjStr: string, keys: any) {
    return JSON.parse(authObjStr);
}

module.exports = {
    decodeVerifyJwt: decodeVerifyJwt,
    getPublicKeys: getPublicKeys
};
