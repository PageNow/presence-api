const { Client } = require('pg');
const data = require('/opt/nodejs/data');
const constants = require('/opt/nodejs/constants');

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

    const user1 = data.user1;
    const user2 = data.user2;
    const user3 = data.user3;
    const user4 = data.user4;
    try {
        const text = `
            INSERT INTO user_table(user_id, email, first_name, middle_name, last_name, gender, dob, domain_allow_array, domain_deny_array)
            VALUES
                ($1, $2, $3, $4, $5, $6, $7, $8, $9),
                ($10, $11, $12, $13, $14, $15, $16, $17, $18),
                ($19, $20, $21, $22, $23, $24, $25, $26, $27),
                ($28, $29, $30, $31, $32, $33, $34, $35, $36)
        `;
        const values = [
            user1.user_id, user1.email, user1.first_name, user1.middle_name, user1.last_name, user1.gender, user1.dob, constants.DEFAULT_DOMAIN_ALLOW_ARRAY, constants.DEFAULT_DOMAIN_DENY_ARRAY,
            user2.user_id, user2.email, user2.first_name, user2.middle_name, user2.last_name, user2.gender, user2.dob, constants.DEFAULT_DOMAIN_ALLOW_ARRAY, constants.DEFAULT_DOMAIN_DENY_ARRAY,
            user3.user_id, user3.email, user3.first_name, user3.middle_name, user3.last_name, user3.gender, user3.dob, constants.DEFAULT_DOMAIN_ALLOW_ARRAY, constants.DEFAULT_DOMAIN_DENY_ARRAY,
            user4.user_id, user4.email, user4.first_name, user4.middle_name, user4.last_name, user4.gender, user4.dob, constants.DEFAULT_DOMAIN_ALLOW_ARRAY, constants.DEFAULT_DOMAIN_DENY_ARRAY
        ];
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
