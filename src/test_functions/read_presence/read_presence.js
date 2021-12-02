const redis = require('redis');
const { promisify } = require('util');
const _ = require('lodash');
const data = require('/opt/nodejs/data');
const constants = require('/opt/nodejs/constants');

const redisPresenceEndpoint = process.env.REDIS_READER_HOST || 'host.docker.internal';
const redisPresencePort = process.env.REDIS_READER_PORT || 6379;
const redisPresence = redis.createClient(redisPresencePort, redisPresenceEndpoint);
const hmget = promisify(redisPresence.hmget).bind(redisPresence);
const zrange = promisify(redisPresence.zrange).bind(redisPresence);

exports.handler = async function(event) {
    let userConnectionIdArr = [];
    let pageArr = [];
    let statusObj = {};
    const userIdArr = [
        data.user1.user_id, data.user2.user_id, data.user3.user_id, data.user4.user_id,
        data.user5.user_id, data.user6.user_id, data.user7.user_id, data.user8.user_id,
        data.user9.user_id, data.user10.user_id
    ];
    try {
        userConnectionIdArr = await hmget(constants.REDIS_KEY_USER_CONNECTION, userIdArr);
        pageArr = await hmget(constants.REDIS_KEY_PAGE, userIdArr);
        const result = await zrange(constants.REDIS_KEY_STATUS, 0, 9, "withscores");
        console.log(result);
        statusObj = _.fromPairs(_.chunk(result, 2));
    } catch (error) {
        console.log(error);
        return { statusCode: 500, body: 'Redis error: ' + JSON.stringify(error) };
    }

    return { statusCode: 200, body: { userConnectionIdArr, pageArr, statusObj } };
};
