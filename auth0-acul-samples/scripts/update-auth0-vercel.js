#!/usr/bin/env node

/**
 * Update Auth0 ACUL Configuration with Vercel Deployment
 * 
 * This script:
 * 1. Reads the built asset files and extracts hashes
 * 2. Constructs the Auth0 configuration
 * 3. Updates Auth0 via Management API
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// Configuration
const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN;
const AUTH0_TOKEN = process.env.AUTH0_MGMT_TOKEN;
const VERCEL_URL = process.env.VERCEL_URL;

// Screens to update
const SCREENS_TO_UPDATE = ['login-id']; // Add more screens as needed: ['login-id', 'signup', 'login-password']

// Validation
if (!AUTH0_DOMAIN || !AUTH0_TOKEN || !VERCEL_URL) {
  console.error('❌ Missing required environment variables:');
  console.error('   - AUTH0_DOMAIN:', AUTH0_DOMAIN ? '✓' : '✗');
  console.error('   - AUTH0_MGMT_TOKEN:', AUTH0_TOKEN ? '✓' : '✗');
  console.error('   - VERCEL_URL:', VERCEL_URL ? '✓' : '✗');
  process.exit(1);
}

console.log('🚀 Starting Auth0 configuration update...');
console.log('📍 Auth0 Domain:', AUTH0_DOMAIN);
console.log('🌐 Vercel URL:', VERCEL_URL);

// Function to extract hash from filename
function extractHash(files, pattern) {
  const file = files.find(f => f.includes(pattern));
  if (!file) {
    console.warn(`⚠️  Could not find file matching pattern: ${pattern}`);
    return null;
  }
  const match = file.match(/\.([a-zA-Z0-9_-]+)\.(js|css)$/);
  return match ? match[1] : null;
}

// Read built assets and extract hashes
function getAssetHashes() {
  const distPath = path.join(__dirname, '../react-js/dist/assets');
  
  if (!fs.existsSync(distPath)) {
    console.error('❌ Build directory not found:', distPath);
    console.error('   Run "npm run build:all" first!');
    process.exit(1);
  }

  // Get all files recursively
  const getAllFiles = (dirPath, arrayOfFiles = []) => {
    const files = fs.readdirSync(dirPath);

    files.forEach(file => {
      const filePath = path.join(dirPath, file);
      if (fs.statSync(filePath).isDirectory()) {
        arrayOfFiles = getAllFiles(filePath, arrayOfFiles);
      } else {
        arrayOfFiles.push(path.relative(distPath, filePath));
      }
    });

    return arrayOfFiles;
  };

  const files = getAllFiles(distPath);
  
  console.log('📦 Found assets:', files.length);

  const hashes = {
    style: extractHash(files, 'shared/style.'),
    main: extractHash(files, 'main.'),
    loginId: extractHash(files, 'login-id/index.'),
    vendor: extractHash(files, 'shared/vendor.'),
    common: extractHash(files, 'shared/common.')
  };

  // Validate all required hashes are found
  const missingHashes = Object.entries(hashes)
    .filter(([key, value]) => !value)
    .map(([key]) => key);

  if (missingHashes.length > 0) {
    console.error('❌ Missing required asset hashes:', missingHashes.join(', '));
    process.exit(1);
  }

  console.log('✅ Extracted hashes:');
  Object.entries(hashes).forEach(([key, value]) => {
    console.log(`   ${key}: ${value}`);
  });

  return hashes;
}

// Build Auth0 configuration
function buildAuth0Config(hashes, baseUrl) {
  // Ensure URL has https:// and no trailing slash
  const cleanUrl = baseUrl.replace(/\/$/, '');
  
  return {
    rendering_mode: 'advanced',
    head_tags: [
      {
        tag: 'base',
        attributes: {
          href: `${cleanUrl}/`
        }
      },
      {
        tag: 'script',
        attributes: {
          src: `${cleanUrl}/assets/main.${hashes.main}.js`,
          type: 'module',
          defer: true
        }
      },
      {
        tag: 'link',
        attributes: {
          rel: 'stylesheet',
          href: `${cleanUrl}/assets/shared/style.${hashes.style}.css`
        }
      },
      {
        tag: 'script',
        attributes: {
          src: `${cleanUrl}/assets/login-id/index.${hashes.loginId}.js`,
          type: 'module',
          defer: true
        }
      },
      {
        tag: 'script',
        attributes: {
          src: `${cleanUrl}/assets/shared/common.${hashes.common}.js`,
          type: 'module',
          defer: true
        }
      },
      {
        tag: 'script',
        attributes: {
          src: `${cleanUrl}/assets/shared/vendor.${hashes.vendor}.js`,
          type: 'module',
          defer: true
        }
      }
    ]
  };
}

// Update Auth0 screen configuration
function updateAuth0Screen(prompt, screen, config) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(config);
    
    const options = {
      hostname: AUTH0_DOMAIN.replace('https://', ''),
      path: `/api/v2/prompts/${prompt}/screen/${screen}/rendering`,
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${AUTH0_TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    };

    const req = https.request(options, (res) => {
      let responseData = '';

      res.on('data', (chunk) => {
        responseData += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200 || res.statusCode === 204) {
          console.log(`✅ Updated ${prompt}/${screen} - Status: ${res.statusCode}`);
          resolve({ success: true, statusCode: res.statusCode });
        } else {
          console.error(`❌ Failed to update ${prompt}/${screen} - Status: ${res.statusCode}`);
          console.error('Response:', responseData);
          reject(new Error(`HTTP ${res.statusCode}: ${responseData}`));
        }
      });
    });

    req.on('error', (error) => {
      console.error(`❌ Request error for ${prompt}/${screen}:`, error.message);
      reject(error);
    });

    req.write(data);
    req.end();
  });
}

// Main execution
async function main() {
  try {
    // Step 1: Get asset hashes
    const hashes = getAssetHashes();
    
    // Step 2: Build configuration
    const config = buildAuth0Config(hashes, VERCEL_URL);
    
    console.log('\n📝 Configuration to be applied:');
    console.log(JSON.stringify(config, null, 2));
    
    // Step 3: Update each screen
    console.log(`\n🔄 Updating ${SCREENS_TO_UPDATE.length} screen(s)...`);
    
    for (const screen of SCREENS_TO_UPDATE) {
      await updateAuth0Screen(screen, screen, config);
      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    console.log('\n🎉 All screens updated successfully!');
    console.log('🔗 Your ACUL is now live at:', VERCEL_URL);
    
    // Save deployment info
    const deploymentInfo = {
      timestamp: new Date().toISOString(),
      vercelUrl: VERCEL_URL,
      hashes: hashes,
      screensUpdated: SCREENS_TO_UPDATE
    };
    
    fs.writeFileSync(
      path.join(__dirname, '../deployment-info.json'),
      JSON.stringify(deploymentInfo, null, 2)
    );
    
    console.log('💾 Deployment info saved to deployment-info.json');
    
  } catch (error) {
    console.error('\n❌ Deployment failed:', error.message);
    process.exit(1);
  }
}

// Run the script
main();