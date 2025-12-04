/**
 * AKM-POS API Test Script
 * Tests both writeToSheet and readSheet endpoints
 */

const API_BASE = 'https://akm-pos-api.onrender.com';

async function testAPI() {
  console.log('🧪 Testing AKM-POS API on Render.com\n');

  // Test 1: Write to Sheet
  console.log('📝 Test 1: Writing test invoice to sheet...');
  try {
    const writeResponse = await fetch(`${API_BASE}/writeToSheet`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'append',
        sheetName: 'Sheet1',
        values: [
          'TEST-' + Date.now(),
          new Date().toLocaleString(),
          '1000.00',
          'Cash',
          JSON.stringify({ items: [{ name: 'Test Item', price: 1000 }] })
        ]
      }),
    });

    const writeData = await writeResponse.json();
    
    if (writeData.success) {
      console.log('✅ Write test PASSED');
      console.log('   Updated range:', writeData.updatedRange);
      console.log('   Updated rows:', writeData.updatedRows);
    } else {
      console.log('❌ Write test FAILED:', writeData.error);
    }
  } catch (error) {
    console.log('❌ Write test ERROR:', error.message);
  }

  console.log('');

  // Test 2: Read from Sheet
  console.log('📖 Test 2: Reading data from sheet...');
  try {
    const readResponse = await fetch(`${API_BASE}/readSheet`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        range: 'A1:E10' // Read first 10 rows
      }),
    });

    const readData = await readResponse.json();
    
    if (readData.success) {
      console.log('✅ Read test PASSED');
      console.log('   Rows retrieved:', readData.values?.length || 0);
      if (readData.values && readData.values.length > 0) {
        console.log('   Sample data:', readData.values[0]);
      }
    } else {
      console.log('❌ Read test FAILED:', readData.error);
    }
  } catch (error) {
    console.log('❌ Read test ERROR:', error.message);
  }

  console.log('');

  // Test 3: Batch Read
  console.log('📚 Test 3: Batch reading multiple ranges...');
  try {
    const batchResponse = await fetch(`${API_BASE}/readSheet`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ranges: ['A1:A5', 'B1:B5']
      }),
    });

    const batchData = await batchResponse.json();
    
    if (batchData.success) {
      console.log('✅ Batch read test PASSED');
      console.log('   Ranges retrieved:', batchData.valueRanges?.length || 0);
    } else {
      console.log('❌ Batch read test FAILED:', batchData.error);
    }
  } catch (error) {
    console.log('❌ Batch read test ERROR:', error.message);
  }

  console.log('\n🎉 API testing complete!\n');
}

// Run tests
testAPI();
