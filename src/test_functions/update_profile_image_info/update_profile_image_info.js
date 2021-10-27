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
    const userId5 = data.user5.user_id;
    const userId6 = data.user6.user_id;
    const userId8 = data.user8.user_id;
    const userId9 = data.user9.user_id;

    try{
        const text = `
            UPDATE user_table SET profile_image_extension = 'png',
                profile_image_uploaded_at = $1
            WHERE user_id = $2 OR user_id = $3 OR user_id = $4 OR user_id = $5
                OR user_id = $6 OR user_id = $7
        `;
        const values = [ new Date(), userId1, userId2, userId5, userId6, userId8, userId9 ];
        await client.query(text, values);
    } catch (error) {
        await client.end();
        console.log(error);
        return { statusCode: 500, body: 'Database error: ' + JSON.stringify(error) };
    }

    let userArr = [];
    try {
        const text = `
            SELECT * FROM user_table
        `;
        const result = await client.query(text);
        userArr = result.rows;
        console.log(userArr);
    } catch (error) {
        await client.end();
        console.log(error);
        return { statusCode: 500, body: 'Database error: ' + JSON.stringify(error) };
    }
    await client.end();

    return { statusCode: 200, body: userArr };
};
