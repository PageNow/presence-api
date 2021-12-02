const AWS = require('aws-sdk');
const { promisify } = require('util');
const redis = require('redis');
const { getPublicKeys, decodeVerifyJwt } = require('/opt/nodejs/decode-verify-jwt');
const constants = require('/opt/nodejs/constants');

const redisPresenceEndpoint = process.env.REDIS_PRIMARY_HOST || 'host.docker.internal';
const redisPresencePort = process.env.REDIS_PRIMARY_PORT || 6379;
const redisPresence = redis.createClient(redisPresencePort, redisPresenceEndpoint);

let cacheKeys;

const dynamoDB = new AWS.DynamoDB({apiVersion: '2012-08-10'});

exports.handler = async function(event) {
    let userId;
    try {
        if (!cacheKeys) {
            cacheKeys = await getPublicKeys();
        }
        const decodedJwt = await decodeVerifyJwt(event.queryStringParameters.Authorization, cacheKeys);
        if (!decodedJwt || !decodedJwt.isValid || decodedJwt.username === '') {
            return { statusCode: 500, body: 'Authentication error' };
        }
        userId = decodedJwt.username;
    } catch (error) {
        return { statusCode: 500, body: 'JWT decode error: ' + JSON.stringify(error) };
    }

    // update connectId
    try {
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
