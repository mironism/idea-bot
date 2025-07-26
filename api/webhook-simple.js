module.exports = async (req, res) => {
  console.log('SIMPLE WEBHOOK CALLED');
  console.log('Method:', req.method);
  console.log('Body:', JSON.stringify(req.body, null, 2));
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    // Just return success for testing
    return res.status(200).json({ 
      success: true, 
      message: 'Simple webhook works!',
      received: req.body
    });
    
  } catch (error) {
    console.error('ERROR:', error);
    return res.status(500).json({
      error: 'Test failed',
      message: error.message
    });
  }
}; 