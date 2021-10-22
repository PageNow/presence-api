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
    const userId5 = data.user5.user_id;
    const userId6 = data.user6.user_id;
    const userId7 = data.user7.user_id;
    const userId8 = data.user8.user_id;
    const userId9 = data.user9.user_id;
    const userId10 = data.user10.user_id;

    // friendship list
    // user1 <-> user2, user1 -> user3, user2 <-> user4, user4 -> user3, user5 <-> user1
    // user6 <-> user1, user7 -> user1, user8 <-> user1, user9 <-> user1, user10 -> user1
    // user5 <-> user2, user2 -> user8, user2 <-> user9, user3 <-> user9, user10 <-> user8,
    // user9 <-> user10, user4 <-> user6, user2 <-> user6,
    const friendship1 = { userId1: userId1, userId2: userId2, acceptedAt: new Date() };
    const friendship2 = { userId1: userId1, userId2: userId3, acceptedAt: null };
    const friendship3 = { userId1: userId2, userId2: userId4, acceptedAt: new Date() };
    const friendship4 = { userId1: userId4, userId2: userId3, acceptedAt: null };
    const friendship5 = { userId1: userId5, userId2: userId1, acceptedAt: new Date() };
    const friendship6 = { userId1: userId6, userId2: userId1, acceptedAt: new Date() };
    const friendship7 = { userId1: userId7, userId2: userId1, acceptedAt: null };
    const friendship8 = { userId1: userId8, userId2: userId1, acceptedAt: new Date() };
    const friendship9 = { userId1: userId9, userId2: userId1, acceptedAt: new Date() };
    const friendship10 = { userId1: userId10, userId2: userId1, acceptedAt: null };
    const friendship11 = { userId1: userId5, userId2: userId2, acceptedAt: new Date() };
    const friendship12 = { userId1: userId2, userId2: userId8, acceptedAt: null };
    const friendship13 = { userId1: userId2, userId2: userId9, acceptedAt: new Date() };
    const friendship14 = { userId1: userId3, userId2: userId9, acceptedAt: new Date() };
    const friendship15 = { userId1: userId10, userId2: userId8, acceptedAt: new Date() };
    const friendship16 = { userId1: userId9, userId2: userId10, acceptedAt: new Date() };
    const friendship17 = { userId1: userId4, userId2: userId6, acceptedAt: new Date() };
    const friendship18 = { userId1: userId2, userId2: userId6, acceptedAt: new Date() };

    try {
        const text = `
            INSERT INTO friendship_table(user_id1, user_id2, accepted_at)
            VALUES
                ( $1,  $2,  $3),
                ( $4,  $5,  $6),
                ( $7,  $8,  $9),
                ($10, $11, $12),
                ($13, $14, $15),
                ($16, $17, $18),
                ($19, $20, $21),
                ($22, $23, $24),
                ($25, $26, $27),
                ($28, $29, $30),
                ($31, $32, $33),
                ($34, $35, $36),
                ($37, $38, $39),
                ($40, $41, $42),
                ($43, $44, $45),
                ($46, $47, $48),
                ($49, $50, $51),
                ($52, $53, $54)
        `;
        const values = [
            friendship1.userId1, friendship1.userId2, friendship1.acceptedAt,
            friendship2.userId1, friendship2.userId2, friendship2.acceptedAt,
            friendship3.userId1, friendship3.userId2, friendship3.acceptedAt,
            friendship4.userId1, friendship4.userId2, friendship4.acceptedAt,
            friendship5.userId1, friendship5.userId2, friendship5.acceptedAt,
            friendship6.userId1, friendship6.userId2, friendship6.acceptedAt,
            friendship7.userId1, friendship7.userId2, friendship7.acceptedAt,
            friendship8.userId1, friendship8.userId2, friendship8.acceptedAt,
            friendship9.userId1, friendship9.userId2, friendship9.acceptedAt,
            friendship10.userId1, friendship10.userId2, friendship10.acceptedAt,
            friendship11.userId1, friendship11.userId2, friendship11.acceptedAt,
            friendship12.userId1, friendship12.userId2, friendship12.acceptedAt,
            friendship13.userId1, friendship13.userId2, friendship13.acceptedAt,
            friendship14.userId1, friendship14.userId2, friendship14.acceptedAt,
            friendship15.userId1, friendship15.userId2, friendship15.acceptedAt,
            friendship16.userId1, friendship16.userId2, friendship16.acceptedAt,
            friendship17.userId1, friendship17.userId2, friendship17.acceptedAt,
            friendship18.userId1, friendship18.userId2, friendship18.acceptedAt
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
