const redis = require('redis');
const { promisify } = require('util');
const { Client } = require('pg');
const jwt = require('jsonwebtoken');

const redisPresenceEndpoint = process.env.REDIS_READER_HOST || 'host.docker.internal';
const redisPresencePort = process.env.REDIS_READER_PORT || 6379;
const redisPresence = redis.createClient(redisPresencePort, redisPresenceEndpoint);
const hget = promisify(redisPresence.hget).bind(redisPresence);

const responseHeader = {
    "Access-Control-Allow-Origin": "*",
};

exports.handler = async function(event) {
    console.log("event", event);
    if (event.pathParameters.userId == undefined || event.pathParameters.userId == null) {
        return {
            statusCode: 500,
            headers: responseHeader,
            body: "Missing 'userId' in event pathParameters"
        };
    }
    const targetUserId = event.pathParameters.userId;

    const jwtDecoded = jwt.decode(event.headers['Authorization']);
    const userId = jwtDecoded['cognito:username'];
    console.log(userId);

    const client = new Client({
        user: process.env.DB_USER,
        host: process.env.DB_HOST,
        database: process.env.DB_DATABASE,
        password: process.env.DB_PASSWORD,
        port: parseInt(process.env.DB_PORT, 10) || 5432,
        ssl: true
    });
    if (userId !== targetUserId) { // check if the user is friends with the target user
        try {
            await client.connect();
            const text = `
                SELECT * FROM friendship_table
                WHERE (user_id1 = $1 AND user_id2 = $2 AND accepted_at IS NOT NULL) OR
                    (user_id1 = $2 AND user_id2 = $1 AND accepted_at IS NOT NULL)
            `;
            const values = [userId, targetUserId];
            const result = await client.query(text, values);
            if (result.rows.length == 0) {
                await client.end();
                return {
                    statusCode: 403,
                    headers: responseHeader,
                    body: 'Forbidden access to user presence'
                };
            }            
        } catch (error) {
            await client.end();
            console.log(error);
            return {
                statusCode: 500,
                headers: responseHeader,
                body: 'Database error: ' + JSON.stringify(error)
            };
        }
        await client.end();
    }

    try {
        let presence = await hget("page", targetUserId);
        if (presence == undefined || presence == null) {
            presence = JSON.parse(presence);
        }
        return {
            statusCode: 200,
            headers: responseHeader,
            body: JSON.stringify(presence)
        };
    } catch (error) {
        return {
            statusCode: 500,
            headers: responseHeader,
            body: 'Redis error: ' + JSON.stringify(error)
        };
    }
};
