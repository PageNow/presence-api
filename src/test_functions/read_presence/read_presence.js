const redis = require('redis');
const { promisify } = require('util');
const _ = require('lodash');
const data = require('/opt/nodejs/data');

const redisPresenceEndpoint = process.env.REDIS_HOST || 'host.docker.internal';
const redisPresencePort = process.env.REDIS_PORT || 6379;
const redisPresence = redis.createClient(redisPresencePort, redisPresenceEndpoint);
const hmget = promisify(redisPresence.hmget).bind(redisPresence);
const zrange = promisify(redisPresence.zrange).bind(redisPresence);

exports.handler = async function(event) {
    let userConnectionIdArr = [];
    let pageArr = [];
    let statusObj = {};
    const userIdArr = [data.user1.user_id, data.user2.user_id, data.user3.user_id, data.user4.user_id];
    try {
        userConnectionIdArr = await hmget("presence_user_connection", userIdArr);
        pageArr = await hmget("page", userIdArr);
        const result = await zrange("status", 0, 3, "withscores");
        console.log(result);
        statusObj = _.fromPairs(_.chunk(result, 2));
    } catch (error) {
        console.log(error);
        return { statusCode: 500, body: 'Redis error: ' + JSON.stringify(error) };
    }

    return { statusCode: 200, body: { userConnectionIdArr, pageArr, statusObj } };
};
