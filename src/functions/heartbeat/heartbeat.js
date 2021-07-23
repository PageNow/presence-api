const AWS = require('aws-sdk');
const redis = require('redis');
const jwt = require('jsonwebtoken');
const { promisify } = require('util');

const redisPresenceEndpoint = process.env.REDIS_HOST || 'host.docker.internal';
const redisPresencePort = process.env.REDIS_PORT || 6379;
const redisPresence = redis.createClient(redisPresencePort, redisPresenceEndpoint);

// const zadd = promisify(redisPresence.zadd).bind(redisPresence);
// const hset = promisify(redisPresence.hset).bind(redisPresence);

// const eventBridge = new AWS.EventBridge();
// const eventBus = process.env.EVENT_BUS;

/**
 * Hearbeat handler:
 * 
 * 1. Check `arguments.url` and `arguments.title` from the event
 * 2. Use zadd to add/update the timestamp and hset to add/update url and title.
 * (3. If the timestamp was added, send a connection event) - skipped for now
 */
exports.handler = async function(event) {
    const url = event && event.arguments && event.arguments.url;
    if (url === undefined || url === null) {
        throw new Error("Missing argument 'url'");
    }
    const title = event && event.arguments && event.arguments.title;
    if (title === undefined || url === null) {
        throw new Error("Missing argument 'title'");
    }

    const decodedJwt = jwt.decode(event.request.headers.authorization, { complete: true });
    if (decodedJwt.payload.iss !== 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_014HGnyeu') {
        throw new Error("Authorization failed");
    }
    const userId = decodedJwt.payload.username;
    console.log(userId);

    const commands = redisPresence.multi();
    commands.zadd('status', Date.now(), userId);
    commands.hset('page', userId, JSON.stringify({url: url, title: title}));
    const execute = promisify(commands.exec).bind(commands);

    try {
        const [result, _] = await execute();
        // if (result == 1) { // New connection. 0 if not updated
        //     await eventBridge.putEvents({
        //         Entries: [{
        //             Detail: JSON.stringify({ userId }),
        //             DetailType: "presence.connected",
        //             Source: "api.presence",
        //             EventBusName: eventBus,
        //             Time: Date.now()
        //         }]
        //     }).promise();
        // }
        return { userId, url, title, status: "online" };
    } catch (error) {
        console.log(error);
        return error;
    }
}
