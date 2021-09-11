const { Client } = require('pg');
const data = require('/opt/nodejs/data');

exports.handler = async function(event) {
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
        return { statusCode: 500, body: 'Database error: ' + JSON.stringify(err) };
    }

    const userId1 = data.user1.user_id;
    const userId2 = data.user2.user_id;
    const userId3 = data.user3.user_id;
    const userId4 = data.user4.user_id;

    // friendship: user1 <-> user2, user1 -> user3, user2 <-> user4, user4 -> user3
    const friendship1 = {
        userId1: userId1,
        userId2: userId2,
        acceptedAt: new Date()
    };
    const friendship2 = {
        userId1: userId1,
        userId2: userId3,
        acceptedAt: new Date()
    };
    const friendship3 = {
        userId1: userId2,
        userId2: userId4,
        acceptedAt: new Date()
    };
    const friendship4 = {
        userId1: userId4,
        userId2: userId3,
        acceptedAt: new Date()
    };
    try {
        const text = `
            INSERT INTO friendship_table(user_id1, user_id2, accepted_at)
            VALUES
                ($1, $2, $3),
                ($4, $5, $6),
                ($7, $8, $9),
                ($10, $11, $12)
        `;
        const values = [
            friendship1.userId1, friendship1.userId2, friendship1.acceptedAt,
            friendship2.userId1, friendship2.userId2, friendship2.acceptedAt,
            friendship3.userId1, friendship3.userId2, friendship3.acceptedAt,
            friendship4.userId1, friendship4.userId2, friendship4.acceptedAt
        ];
        await client.query(text, values);
    } catch (error) {
        await client.end();
        console.log(error);
        return { statusCode: 500, body: 'Database error: ' + JSON.stringify(error) };
    }

    let friendshipArr = [];
    try {
        const text = `
            SELECT * FROM friendship_table
        `;
        const result = await client.query(text);
        friendshipArr = result.rows;
        console.log(friendshipArr);
    } catch (error) {
        await client.end();
        console.log(error);
        return { statusCode: 500, body: 'Database error: ' + JSON.stringify(error) };
    }
    await client.end();

    return { statusCode: 200, body: friendshipArr };
};
