const { promisify } = require('util');
const jwkToPem = require('jwk-to-pem');
const axios = require('axios');
const jwt = require('jsonwebtoken');

const cognitoRegion = 'us-west-2';
const cognitoPoolId = 'us-west-2_32JgtVKUN';
const cognitoIssuer = `https://cognito-idp.${cognitoRegion}.amazonaws.com/${cognitoPoolId}`;

// assume cacheKey is not undefined or null
async function getPublicKeys() {
    const url = `${cognitoIssuer}/.well-known/jwks.json`;
    let cacheKeys;
    try {
        const publicKeys = await axios.default.get(url);
        cacheKeys = publicKeys.data.keys.reduce((agg, current) => {
            const pem = jwkToPem(current);
            agg[current.kid] = {instance: current, pem};
            return agg;
        }, {});
    } catch (error) {
        console.log(error);
        throw new Error('Error while getting publicKeys');
    }
    
    return cacheKeys;
}

async function decodeVerifyJwt(token, keys) {
    let result;
    try {
        if (!token) {
            throw new Error('token is null or undefined');
        }
        if (!keys) {
            throw new Error('cacheKey is null or undefined');
        }
        
        const verifyPromised = promisify(jwt.verify.bind(jwt));
        const tokenSections = (token || '').split('.');
        if (tokenSections.length < 2) {
            throw new Error('Requested token is invalid');
        }
    
        const headerJSON = Buffer.from(tokenSections[0], 'base64').toString('utf8');
        const header = JSON.parse(headerJSON);
        const key = keys[header.kid];
        if (key === undefined) {
            throw new Error('Claim made for unknown kid');
        }
    
        const claim = await verifyPromised(token, key.pem);
        const currentSeconds = Math.floor( (new Date()).valueOf() / 1000);
        if (currentSeconds > claim.exp || currentSeconds < claim.auth_time) {
            throw new Error('Claim is expired or invalid');
        }
        if (claim.iss !== cognitoIssuer) {
            throw new Error('Claim issuer is invalid');
        }
        if (claim.token_use !== 'access') {
            throw new Error('claim use is not access');
        }
        console.log(claim);
        console.log(`Claim confirmed for ${claim.username}`);
        result = {
            userName: claim['cognito:username'],
            clientId: claim.client_id,
            isValid: true
        };
        console.log(result);
    } catch (error) {
        result = { userName: '', clientId: '', error, isValid: false };
    }
    return result;
}

module.exports = {
    decodeVerifyJwt: decodeVerifyJwt,
    getPublicKeys: getPublicKeys
};
