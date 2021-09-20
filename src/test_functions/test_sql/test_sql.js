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

    let result;
    try {
        // const text = `
        //     SELECT f.user_id1, u1.first_name as first_name1, u1.last_name as last_name1,
        //         f.user_id2, u2.first_name as first_name2, u2.last_name as last_name2
        //     FROM (SELECT * FROM friendship_table
        //             WHERE (user_id1 = $1 OR user_id2 = $1) AND
        //                 accepted_at IS NOT NULL) as f
        //         INNER JOIN user_table as u1 ON (u1.user_id = f.user_id1)
        //         INNER JOIN user_table as u2 ON (u2.user_id = f.user_id2)
        // `;
        // const values = [data.user1.user_id];
        let text = `
            SELECT user_id FROM user_table
        `;
        result = await client.query(text);
        console.log(result.rows);
        let friendIdArr = result.rows.map(x => x.user_id);
        console.log(friendIdArr);
        text = `
            SELECT user_id, first_name, middle_name, last_name
            FROM user_table
            WHERE user_id = ANY ($1)
        `;
        result = await client.query(text, [friendIdArr]);
    } catch (error) {
        console.log(error);
        await client.end();
        return { statusCode: 500, body: 'Database error: ' + JSON.stringify(error) };
    }
    await client.end();
    console.log(result.rows);
};
