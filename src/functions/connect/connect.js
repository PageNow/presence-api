const AWS = require('aws-sdk');
const { promisify } = require('util');
const redis = require('redis');
const { getPublicKeys, decodeVerifyJwt } = require('/opt/nodejs/decode-verify-jwt');
const constants = require('/opt/nodejs/constants');

// Redis connection variables
const redisPresenceEndpoint = process.env.REDIS_PRIMARY_HOST || 'host.docker.internal';
const redisPresencePort = process.env.REDIS_PRIMARY_PORT || 6379;
const redisPresence = redis.createClient(redisPresencePort, redisPresenceEndpoint);

let cacheKeys; // public keys used for authentication

exports.handler = async function(event) {
    let userId;
    try {
        // if cacheKeys is not cached, get the public keys and save to cacheKeys
        if (!cacheKeys) {
            cacheKeys = await getPublicKeys();
        }
        // validate the JWT passed as a query parameter upon connection and extract the user id
        const decodedJwt = await decodeVerifyJwt(event.queryStringParameters.Authorization, cacheKeys);
        if (!decodedJwt || !decodedJwt.isValid || decodedJwt.username === '') {
            return { statusCode: 500, body: 'Authentication error' };
        }
        userId = decodedJwt.username;
    } catch (error) {
        return { statusCode: 500, body: 'JWT decode error: ' + JSON.stringify(error) };
    }

    // set a mapping of connectionId to userId and a mapping of userId to connectionId
    try {
        // use transactions to set values for REDIS_KEY_USER_CONNECTION and REDIS_KEY_CONNECTION_USER
        const commands = redisPresence.multi();
        commands.hset(constants.REDIS_KEY_USER_CONNECTION, userId, event.requestContext.connectionId);
        commands.hset(constants.REDIS_KEY_CONNECTION_USER, event.requestContext.connectionId, userId);
        const execute = promisify(commands.exec).bind(commands);
        await execute();
    } catch (error) {
        console.log(error);
        return { statusCode: 500, body: 'Redis error: ' + JSON.stringify(error) };
    }

    // save CONNECTION event to UserActivityHistoryTable
    const dynamoDB = new AWS.DynamoDB({apiVersion: '2012-08-10'});
    try {
        const result = await dynamoDB.putItem({
            TableName: process.env.USER_ACTIVITY_HISTORY_TABLE_NAME,
            Item: {
                user_id: { S: userId },
                timestamp: { S: new Date(Date.now()).toISOString() },
                type: { S: "CONNECT" }
            }
        }).promise();
        console.log(result);
    } catch (error) {
        console.log(error);
    }
   
    return { 
        statusCode: 200, 
        body: JSON.stringify({ connectionId: event.requestContext.connectionId })
    };
};
