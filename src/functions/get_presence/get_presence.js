const redis = require('redis');
const { promisify } = require('util');
const { Client } = require('pg');
const jwt = require('jsonwebtoken');
const psl = require('psl');
const constants = require('/opt/nodejs/constants');

// Redis connection variables
const redisPresenceEndpoint = process.env.REDIS_READER_HOST || 'host.docker.internal';
const redisPresencePort = process.env.REDIS_READER_PORT || 6379;
const redisPresence = redis.createClient(redisPresencePort, redisPresenceEndpoint);

// promisified Redis command
const hmget = promisify(redisPresence.hmget).bind(redisPresence);

// header to resolve CORS error
const responseHeader = {
    "Access-Control-Allow-Origin": "*",
};

exports.handler = async function(event) {
    // note that JWT is verified at AWS API Gateway level
    const jwtDecoded = jwt.decode(event.headers['Authorization']);
    const userId = jwtDecoded['cognito:username'];

    // connect to AWS RDS PostgreSQL
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
    let userInfoMap = {}; // map of userinfo of friends and the user
    try {
        // SQL query to get the list of friends
        let text = `
            SELECT user_id1, user_id2 FROM friendship_table
            WHERE (user_id1 = $1 OR user_id2 = $1) AND
                accepted_at IS NOT NULL
        `;
        let values = [userId];
        let result = await client.query(text, values);
        console.log('friend query result', result.rows);
        friendIdArr = result.rows.map(x => x.user_id1 === userId ? x.user_id2 : x.user_id1);
        friendIdArr.push(userId);

        // SQL query to get the user information of friends
        text = `
            SELECT user_id, first_name, last_name, profile_image_extension
            FROM user_table
            WHERE user_id = ANY ($1)
        `;
        result = await client.query(text, [friendIdArr]);
        result.rows.forEach(x => userInfoMap[x.user_id] = x);
        console.log('userInfoMap', userInfoMap);
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

    // get the presence data and the latest shared activity data of friends
    let pageArr = [];
    let latestPageArr = [];
    try {
        pageArr = await hmget(constants.REDIS_KEY_PAGE, friendIdArr);
        latestPageArr = await hmget(constants.REDIS_KEY_LATEST_PAGE, friendIdArr);
    } catch (error) {
        console.log(error);
        return {
            statusCode: 500,
            headers: responseHeader,
            body: 'Redis error: ' + JSON.stringify(error)
        };
    }
    console.log(pageArr);
    console.log(latestPageArr);
    if (pageArr.length !== friendIdArr.length) {
        return {
            statusCode: 500,
            headers: responseHeader,
            body: 'Redis error'
        };
    }

    // organize the raw Redis data for easier processing
    const presence = {}; // { user id: presence data }
    friendIdArr.forEach((key, i) => {
        if (pageArr[i] == undefined || pageArr[i] == null) { // offline
            presence[key] = {
                userId: key,
                page: null,
                latestPage: null
            };
        } else { // online
            const page = JSON.parse(pageArr[i]); // pageArr[i] guaranteed to be not null
            let latestPage = { url: '', title: '' };
            if (latestPageArr[i]) {
                latestPage = JSON.parse(latestPageArr[i]);
            }
            presence[key] = {
                userId: key,
                page: page,
                latestPage: latestPage
            };

            let domain = '';
            if (page.url !== '') {
                try {
                    const urlObj = new URL(page.url);
                    const parsed = psl.parse(urlObj.hostname);
                    domain = parsed.domain;
                } catch (error) {
                    console.log(error);
                }
            }
            presence[key].page['domain'] = domain;

            let latestDomain = '';
            if (latestPage.url !== '') {
                try {
                    const latestUrlObj = new URL(latestPage.url);
                    const parsed = psl.parse(latestUrlObj.hostname);
                    latestDomain = parsed.domain;
                } catch (error) {
                    console.log(error);
                }
            }
            presence[key].latestPage['domain'] = latestDomain;
        }
    });
    console.log('presence', presence);

    const presenceArr = []; // array of presence data of friends
    for (const friendId of friendIdArr) {
        if (friendId === userId) { continue; }
        if (presence[friendId]) {
            presenceArr.push(presence[friendId]);
        }
    }
    console.log('presenceArr', presenceArr);

    return {
        statusCode: 200,
        headers: responseHeader,
        body: JSON.stringify({
            userPresence: presence[userId], // presence data of the user
            presenceArr: presenceArr, // presence data of friends
            userInfoMap: userInfoMap
        })
    };
};
