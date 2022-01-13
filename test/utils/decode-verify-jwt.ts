async function getPublicKeys() {
    return { };
}

async function decodeVerifyJwt(authObjStr, keys) {
    return JSON.parse(authObjStr);
}

module.exports = {
    decodeVerifyJwt: decodeVerifyJwt,
    getPublicKeys: getPublicKeys
};
