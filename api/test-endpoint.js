require('dotenv').config();

module.exports = async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('Test endpoint called with body:', JSON.stringify(req.body, null, 2));
    
    return res.status(200).json({ 
      success: true, 
      message: 'Test endpoint works!',
      timestamp: new Date().toISOString(),
      body: req.body
    });

  } catch (error) {
    console.error('Test endpoint error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}; 