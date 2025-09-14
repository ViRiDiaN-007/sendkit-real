const DatabaseService = require('./src/services/DatabaseService');
require('dotenv').config();

async function testPostgreSQL() {
  console.log('🧪 Testing PostgreSQL connection...');
  
  try {
    const db = new DatabaseService();
    await db.initialize();
    
    console.log('✅ PostgreSQL connection successful!');
    console.log('✅ Database tables created!');
    
    // Test a simple query
    const result = await db.query('SELECT NOW() as current_time');
    console.log('✅ Query test successful:', result.rows[0]);
    
    await db.close();
    console.log('✅ Connection closed successfully!');
    
  } catch (error) {
    console.error('❌ PostgreSQL test failed:', error.message);
    process.exit(1);
  }
}

testPostgreSQL();
