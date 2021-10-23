const redis = require('redis');
const { promisify } = require('util');
const { Client } = require('pg');
const { getPublicKeys, decodeVerifyJwt } = require('/opt/nodejs/decode-verify-jwt');
const psl = require('psl');

const redisPresenceEndpoint = process.env.REDIS_READER_HOST || 'host.docker.internal';
const redisPresencePort = process.env.REDIS_READER_PORT || 6379;
const redisPresence = redis.createClient(redisPresencePort, redisPresenceEndpoint);
const hmget = promisify(redisPresence.hmget).bind(redisPresence);

let cacheKeys;
const responseHeader = {
    "Access-Control-Allow-Origin": "*",
};

exports.handler = async function(event) {
    let userId;
    try {
        if (!cacheKeys) {
            cacheKeys = await getPublicKeys();
        }
        const decodedJwt = await decodeVerifyJwt(event.headers.Authorization, cacheKeys);
        console.log(decodedJwt);
        if (!decodedJwt || !decodedJwt.isValid || decodedJwt.username === '') {
            console.log('Authorization error');
            return {
                statusCode: 500,
                headers: responseHeader,
                body: 'Authentication error'
            };
        }
        userId = decodedJwt.username;
    } catch (error) {
        return {
            statusCode: 500,
            headers: responseHeader,
            body: 'JWT decode error: ' + JSON.stringify(error)
        };
    }
    console.log(userId);

    const client = new Client({
        user: process.env.DB_USER,
        host: process.env.DB_HOST,
        database: process.env.DB_DATABASE,
        password: process.env.DB_PASSWORD,
        port: parseInt(process.env.DB_PORT, 10) || 5432,
        ssl: true
    });
    try {
        await client.connect();
    } catch (err) {
        console.log(err);
        return {
            statusCode: 500,
            headers: responseHeader,
            body: 'Database error: ' + JSON.stringify(err)
        };
    }

    let friendIdArr = [];
    let userInfoMap = {}; // map of userinfo of friends and yourself
    try {
        let text = `
            SELECT user_id1, user_id2 FROM friendship_table
            WHERE (user_id1 = $1 OR user_id2 = $1) AND
                accepted_at IS NOT NULL
        `;
        let values = [userId];
        let result = await client.query(text, values);
        console.log(result.rows);
        friendIdArr = result.rows.map(x => x.user_id1 === userId ? x.user_id2 : x.user_id1);
        friendIdArr.push(userId);

        text = `
            SELECT user_id, first_name, last_name, profile_image_extension
            FROM user_table
            WHERE user_id = ANY ($1)
        `;
        result = await client.query(text, [friendIdArr]);
        result.rows.forEach(x => userInfoMap[x.user_id] = x);
        console.log(userInfoMap);
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

    let pageArr = [];
    try {
        pageArr = await hmget("page", friendIdArr);
    } catch (error) {
        console.log(error);
        return {
            statusCode: 500,
            headers: responseHeader,
            body: 'Redis error: ' + JSON.stringify(error)
        };
    }
    console.log(pageArr);
    if (pageArr.length !== friendIdArr.length) {
        return {
            statusCode: 500,
            headers: responseHeader,
            body: 'Redis error'
        };
    }

    const presence = {};
    friendIdArr.forEach((key, i) => {
        if (pageArr[i] == undefined || pageArr[i] == null) { // offline
            presence[key] = {
                userId: key,
                page: null
            };
        } else { // online
            const page = JSON.parse(pageArr[i]);
            presence[key] = {
                userId: key,
                page: page
            };
            let domain;
            try {
                const urlObj = new URL(page.url);
                const parsed = psl.parse(urlObj.hostname);
                domain = parsed.domain;
            } catch (error) {
                console.log(error);
            }
            presence[key].page['domain'] = domain;
        }
    });
    console.log(presence);

    const presenceArr = [];
    for (const friendId of friendIdArr) {
        if (friendId === userId) { continue; }
        // if (presence[friendId]) {
        //     presenceArr.unshift(presence[friendId]);
        // } else {
        //     presenceArr.push(presence[friendId]);
        // }

        // only return presence info of online friends
        if (presence[friendId]) {
            presenceArr.push(presence[friendId]);
        }
    }
    console.log(presenceArr);

    return {
        statusCode: 200,
        headers: responseHeader,
        body: JSON.stringify({
            userPresence: presence[userId],
            presenceArr: presenceArr,
            userInfoMap: userInfoMap
        })
    };
};
