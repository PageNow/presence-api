const { Client } = require('pg');

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

    const user1 = {
        userId: "543449a2-9225-479e-bf0c-c50da6b16b7c",
        email: "ykhl1itj@naver.com",
        first_name: "Yongkyun",
        middle_name: "",
        last_name: "Lee",
        gender: "male",
        dob: "1996-03-02"
    };
    const user2 = {
        userId: "f39fbebb-d4c0-4520-9eb3-2cf5fdb734e2",
        email: "yongkyun.daniel.lee@gmail.com",
        first_name: "Drew",
        middle_name: "",
        last_name: "Choi",
        gender: "male",
        dob: "1996-09-11"
    };
    const user3 = {
        userId: "google_117429865182265482928",
        email: "2dragonvirus@gmail.com",
        first_name: "Jisoo",
        middle_name: "",
        last_name: "Lee",
        gender: "female",
        dob: "1996-08-08"
    };

    try {
        const text = `
            INSERT INTO user_table(user_id, email, first_name, middle_name, last_name, gender, dob)
            VALUES
                ($1, $2, $3, $4, $5, $6, $7),
                ($8, $9, $10, $11, $12, $13, $14),
                ($15, $16, $17, $18, $19, $20, $21)
        `;
        const values = [
            user1.userId, user1.email, user1.first_name, user1.middle_name, user1.last_name, user1.gender, user1.dob,
            user2.userId, user2.email, user2.first_name, user2.middle_name, user2.last_name, user2.gender, user2.dob,
            user3.userId, user3.email, user3.first_name, user3.middle_name, user3.last_name, user3.gender, user3.dob,
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
