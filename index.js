const { Ed25519Keypair } = require('@mysten/sui.js/keypairs/ed25519');
const { getFullnodeUrl, SuiClient } = require('@mysten/sui.js/client');
const { TransactionBlock } = require('@mysten/sui.js/transactions');
const { decodeSuiPrivateKey } = require('@mysten/sui.js/cryptography');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const readline = require('readline');
const { HttpsProxyAgent } = require('https-proxy-agent');

require('dotenv').config();

const PACKAGE_ID = '0x4cb081457b1e098d566a277f605ba48410e26e66eaab5b3be4f6c560e9501800';
const SUI_RPC_URL = process.env.SUI_RPC_URL || getFullnodeUrl('testnet');
const DEFAULT_IMAGE_URL = 'https://picsum.photos/800/600';
const LOCAL_IMAGE_PATH = path.join(__dirname, 'image.jpg');
const PUBLISHER_URLS = [
  'https://seal-example.vercel.app/publisher1/v1/blobs',
  'https://seal-example.vercel.app/publisher2/v1/blobs',
  'https://seal-example.vercel.app/publisher3/v1/blobs',
  'https://seal-example.vercel.app/publisher4/v1/blobs',
  'https://seal-example.vercel.app/publisher5/v1/blobs',
  'https://seal-example.vercel.app/publisher6/v1/blobs',
];

const SYMBOLS = {
  info: '📌',
  success: '✅',
  error: '❌',
  warning: '⚠️',
  processing: '🔄',
  wallet: '👛',
  upload: '📤',
  download: '📥',
  network: '🌐',
  divider: '═════════════════════════════════════════'
};

const logger = {
  info: (message) => console.log(`${SYMBOLS.info} ${message}`),
  success: (message) => console.log(`${SYMBOLS.success} ${message}`),
  error: (message) => console.log(`${SYMBOLS.error} ${message}`),
  warning: (message) => console.log(`${SYMBOLS.warning} ${message}`),
  processing: (message) => console.log(`${SYMBOLS.processing} ${message}`),
  wallet: (message) => console.log(`${SYMBOLS.wallet} ${message}`),
  upload: (message) => console.log(`${SYMBOLS.upload} ${message}`),
  download: (message) => console.log(`${SYMBOLS.download} ${message}`),
  network: (message) => console.log(`${SYMBOLS.network} ${message}`),
  divider: () => console.log(SYMBOLS.divider),
  result: (key, value) => console.log(`   ${key.padEnd(15)}: ${value}`)
};

class ProxyManager {
  constructor(proxyFilePath) {
    this.proxyFilePath = proxyFilePath;
    this.proxies = [];
    this.currentProxyIndex = 0;
    this.loadProxies();
  }

  loadProxies() {
    try {
      if (fs.existsSync(this.proxyFilePath)) {
        const proxyData = fs.readFileSync(this.proxyFilePath, 'utf8');
        this.proxies = proxyData
          .split('\n')
          .map(proxy => proxy.trim())
          .filter(proxy => proxy && !proxy.startsWith('#'));
        
        if (this.proxies.length > 0) {
          logger.success(`Loaded ${this.proxies.length} proxies from ${this.proxyFilePath}`);
        } else {
          logger.warning('No proxies found in proxy file. Continuing without proxies.');
        }
      } else {
        logger.warning(`Proxy file ${this.proxyFilePath} not found. Continuing without proxies.`);
      }
    } catch (error) {
      logger.error(`Error loading proxies: ${error.message}`);
    }
  }

  getNextProxy() {
    if (this.proxies.length === 0) return null;
    
    const proxy = this.proxies[this.currentProxyIndex];
    this.currentProxyIndex = (this.currentProxyIndex + 1) % this.proxies.length;
    return this.formatProxy(proxy);
  }

  formatProxy(proxyString) {
    if (!proxyString) return null;
    
    if (proxyString.includes('@')) {
      const [auth, hostPort] = proxyString.split('@');
      const [username, password] = auth.split(':');
      const [host, port] = hostPort.split(':');
      return {
        host,
        port,
        auth: { username, password }
      };
    }
    
    if (proxyString.split(':').length === 4) {
      const [host, port, username, password] = proxyString.split(':');
      return {
        host,
        port,
        auth: { username, password }
      };
    }
    
    if (proxyString.split(':').length === 2) {
      const [host, port] = proxyString.split(':');
      return { host, port };
    }
    
    return null;
  }

  createProxyAgent() {
    const proxy = this.getNextProxy();
    if (!proxy) return null;
    
    let proxyUrl = `http://${proxy.host}:${proxy.port}`;
    
    if (proxy.auth && proxy.auth.username && proxy.auth.password) {
      proxyUrl = `http://${proxy.auth.username}:${proxy.auth.password}@${proxy.host}:${proxy.port}`;
    }
    
    logger.network(`Using proxy: ${proxy.host}:${proxy.port}`);
    return new HttpsProxyAgent(proxyUrl);
  }
}

class SuiAllowlistBot {
  constructor(keyInput, proxyManager = null) {
    this.client = new SuiClient({ url: SUI_RPC_URL });
    this.proxyManager = proxyManager;
    this.address = this.initializeKeypair(keyInput);
  }

  initializeKeypair(keyInput) {
    try {
      if (keyInput.startsWith('suiprivkey')) {
        const { secretKey } = decodeSuiPrivateKey(keyInput);
        this.keypair = Ed25519Keypair.fromSecretKey(secretKey);
      } else if (keyInput.startsWith('0x') || /^[0-9a-fA-F]{64}$/.test(keyInput)) {
        const privateKeyBytes = Buffer.from(keyInput.startsWith('0x') ? keyInput.slice(2) : keyInput, 'hex');
        this.keypair = Ed25519Keypair.fromSecretKey(privateKeyBytes);
      } else if (/^[A-Za-z0-9+/=]+$/.test(keyInput) && keyInput.length === 44) {
        const privateKeyBytes = Buffer.from(keyInput, 'base64');
        this.keypair = Ed25519Keypair.fromSecretKey(privateKeyBytes);
      } else {
        this.keypair = Ed25519Keypair.deriveKeypair(keyInput);
      }
      
      const address = this.keypair.getPublicKey().toSuiAddress();
      logger.info(`Initialized wallet with address: ${address}`);
      return address;
    } catch (error) {
      logger.error(`Error initializing keypair: ${error.message}`);
      throw error;
    }
  }

  getAddress() {
    return this.address;
  }

  generateRandomName() {
    const adjectives = ['cool', 'awesome', 'top', 'excellent', 'perfect'];
    const nouns = ['project', 'creation', 'work', 'masterpiece', 'innovation'];
    const randomAdjective = adjectives[Math.floor(Math.random() * adjectives.length)];
    const randomNoun = nouns[Math.floor(Math.random() * nouns.length)];
    const randomNum = Math.floor(Math.random() * 1000);
    return `${randomAdjective}-${randomNoun}-${randomNum}`;
  }

  async createAllowlist(name = null) {
    const entryName = name || this.generateRandomName();
    logger.processing(`Creating allowlist with name: ${entryName}`);
    const txb = new TransactionBlock();
    txb.moveCall({
      target: `${PACKAGE_ID}::allowlist::create_allowlist_entry`,
      arguments: [txb.pure(entryName)],
    });
    txb.setGasBudget(10000000);

    try {
      const result = await this.client.signAndExecuteTransactionBlock({
        transactionBlock: txb,
        signer: this.keypair,
        options: { showEffects: true, showEvents: true },
        requestType: 'WaitForLocalExecution',
      });
      const createdObjects = result.effects?.created || [];
      const entryObjectId = createdObjects.find(obj => obj.owner?.AddressOwner === this.getAddress())?.reference?.objectId;
      const allowlistId = createdObjects.find(obj => obj.owner?.Shared)?.reference?.objectId;

      if (!allowlistId || !entryObjectId) {
        throw new Error('Could not get allowlistId or entryObjectId');
      }

      logger.success(`Successfully created allowlist`);
      logger.result('Allowlist ID', allowlistId);
      logger.result('Entry ID', entryObjectId);
      return { allowlistId, entryObjectId };
    } catch (error) {
      logger.error(`Error creating allowlist: ${error.message}`);
      throw error;
    }
  }

  async addToAllowlist(allowlistId, entryObjectId, address) {
    logger.processing(`Adding ${address} to allowlist`);
    const txb = new TransactionBlock();
    txb.moveCall({
      target: `${PACKAGE_ID}::allowlist::add`,
      arguments: [
        txb.object(allowlistId),
        txb.object(entryObjectId),
        txb.pure(address),
      ],
    });
    txb.setGasBudget(10000000);

    try {
      const result = await this.client.signAndExecuteTransactionBlock({
        transactionBlock: txb,
        signer: this.keypair,
        options: { showEffects: true },
        requestType: 'WaitForLocalExecution',
      });
      logger.success(`Successfully added address to allowlist`);
      return result;
    } catch (error) {
      logger.error(`Error adding to allowlist: ${error.message}`);
      throw error;
    }
  }

  async addServiceEntry(amount, duration, name = null) {
    const serviceName = name || this.generateRandomName();
    logger.processing(`Adding service entry: ${serviceName} (Amount: ${amount}, Duration: ${duration})`);
    const txb = new TransactionBlock();
    txb.moveCall({
      target: `${PACKAGE_ID}::subscription::create_service_entry`,
      arguments: [
        txb.pure(amount, 'u64'),
        txb.pure(duration, 'u64'),
        txb.pure(serviceName),
      ],
    });
    txb.setGasBudget(10000000);

    try {
      const result = await this.client.signAndExecuteTransactionBlock({
        transactionBlock: txb,
        signer: this.keypair,
        options: { showEffects: true },
        requestType: 'WaitForLocalExecution',
      });
      const createdObjects = result.effects?.created || [];
      const serviceEntryId = createdObjects.find(obj => obj.owner?.AddressOwner === this.getAddress())?.reference?.objectId;
      const sharedObjectId = createdObjects.find(obj => obj.owner?.Shared)?.reference?.objectId;

      if (!serviceEntryId || !sharedObjectId) {
        throw new Error('Could not get serviceEntryId or sharedObjectId');
      }

      logger.success(`Successfully created service entry`);
      logger.result('Shared ID', sharedObjectId);
      logger.result('Entry ID', serviceEntryId);
      return { sharedObjectId, serviceEntryId };
    } catch (error) {
      logger.error(`Error adding service entry: ${error.message}`);
      throw error;
    }
  }

  async fetchImageFromUrl(imageUrl) {
    logger.download(`Downloading image from URL`);
    
    const axiosConfig = {};
    if (this.proxyManager) {
      const proxyAgent = this.proxyManager.createProxyAgent();
      if (proxyAgent) {
        axiosConfig.httpsAgent = proxyAgent;
      }
    }
    
    try {
      const response = await axios({
        method: 'get',
        url: imageUrl,
        responseType: 'arraybuffer',
        ...axiosConfig
      });
      const imageData = Buffer.from(response.data);
      logger.success(`Downloaded image: ${(imageData.length / 1024).toFixed(2)} KB`);
      return imageData;
    } catch (error) {
      logger.error(`Error downloading image: ${error.message}`);
      throw error;
    }
  }

  async loadLocalImage(imagePath) {
    logger.download(`Loading local image`);
    try {
      const imageData = fs.readFileSync(imagePath);
      logger.success(`Loaded image: ${(imageData.length / 1024).toFixed(2)} KB`);
      return imageData;
    } catch (error) {
      logger.error(`Error loading local image: ${error.message}`);
      throw error;
    }
  }

  async uploadBlob(imageSource, epochs = 1, maxRetries = 15) {
    let imageData;
    if (typeof imageSource === 'string' && imageSource.match(/^https?:\/\//)) {
      imageData = await this.fetchImageFromUrl(imageSource);
    } else if (typeof imageSource === 'string' && imageSource === LOCAL_IMAGE_PATH) {
      imageData = await this.loadLocalImage(imageSource);
    } else {
      imageData = imageSource;
    }

    logger.upload(`Uploading blob for ${epochs} epochs`);
    let attempt = 1;
    const delayMs = 5000;

    while (attempt <= maxRetries) {
      const randomIndex = Math.floor(Math.random() * PUBLISHER_URLS.length);
      const publisherUrl = `${PUBLISHER_URLS[randomIndex]}?epochs=${epochs}`;
      logger.processing(`Attempt ${attempt}: Using publisher${randomIndex + 1}`);

      try {
        const axiosConfig = {};
        if (this.proxyManager) {
          const proxyAgent = this.proxyManager.createProxyAgent();
          if (proxyAgent) {
            axiosConfig.httpsAgent = proxyAgent;
          }
        }

        const response = await axios({
          method: 'put',
          url: publisherUrl,
          headers: { 'Content-Type': 'application/octet-stream' },
          data: imageData,
          ...axiosConfig
        });

        let blobId;
        if (response.data && response.data.newlyCreated && response.data.newlyCreated.blobObject) {
          blobId = response.data.newlyCreated.blobObject.blobId;
          console.log('newlyCreated');
        } else if (response.data && response.data.alreadyCertified) {
          blobId = response.data.alreadyCertified.blobId;
          console.log('alreadyCertified');
        } else {
          throw new Error(`Invalid response structure from publisher`);
        }

        if (!blobId) {
          throw new Error(`Missing Blob ID in response`);
        }

        logger.success(`Successfully uploaded blob`);
        logger.result('Blob ID', blobId);
        return blobId;
      } catch (error) {
        logger.error(`Upload failed on attempt ${attempt}: ${error.message}`);
        if (attempt === maxRetries) {
          logger.error(`Reached maximum attempts (${maxRetries}). Giving up.`);
          throw new Error('Could not upload blob after maximum attempts');
        }
        logger.warning(`Retrying in ${delayMs / 1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        attempt++;
      }
    }
  }

  async publishToAllowlist(allowlistId, entryObjectId, blobId) {
    logger.processing(`Publishing blob to allowlist`);
    const txb = new TransactionBlock();
    txb.moveCall({
      target: `${PACKAGE_ID}::allowlist::publish`,
      arguments: [
        txb.object(allowlistId),
        txb.object(entryObjectId),
        txb.pure(blobId),
      ],
    });
    txb.setGasBudget(10000000);

    try {
      await this.client.signAndExecuteTransactionBlock({
        transactionBlock: txb,
        signer: this.keypair,
        options: { showEffects: true },
        requestType: 'WaitForLocalExecution',
      });
      logger.success(`Successfully published content to allowlist`);
      return true;
    } catch (error) {
      logger.error(`Error publishing to allowlist: ${error.message}`);
      throw error;
    }
  }

  async publishToSubscription(sharedObjectId, serviceEntryId, blobId) {
    logger.processing(`Publishing blob to subscription service`);
    const txb = new TransactionBlock();
    txb.moveCall({
      target: `${PACKAGE_ID}::subscription::publish`,
      arguments: [
        txb.object(sharedObjectId),
        txb.object(serviceEntryId),
        txb.pure(blobId),
      ],
    });
    txb.setGasBudget(10000000);

    try {
      await this.client.signAndExecuteTransactionBlock({
        transactionBlock: txb,
        signer: this.keypair,
        options: { showEffects: true },
        requestType: 'WaitForLocalExecution',
      });
      logger.success(`Successfully published content to subscription service`);
      return true;
    } catch (error) {
      logger.error(`Error publishing to subscription service: ${error.message}`);
      throw error;
    }
  }

  async runAllowlistWorkflow(imageSource = DEFAULT_IMAGE_URL, additionalAddresses = [], count = 1) {
    logger.info(`Starting allowlist workflow for ${count} allowlists`);
    const results = [];
    
    try {
      for (let i = 1; i <= count; i++) {
        logger.divider();
        logger.info(`Processing allowlist ${i} of ${count}`);
        
        const { allowlistId, entryObjectId } = await this.createAllowlist();
        await this.addToAllowlist(allowlistId, entryObjectId, this.getAddress());
        
        if (additionalAddresses.length > 0) {
          for (const address of additionalAddresses) {
            await this.addToAllowlist(allowlistId, entryObjectId, address);
          }
        }
        
        const blobId = await this.uploadBlob(imageSource);
        await this.publishToAllowlist(allowlistId, entryObjectId, blobId);
        
        results.push({ allowlistId, entryObjectId, blobId });
      }
      
      logger.divider();
      logger.success(`Quy trình danh sách trắng hoàn tất thành công`);
      return results;
    } catch (error) {
      logger.error(`Quy trình danh sách trắng thất bại: ${error.message}`);
      throw error;
    }
  }

  async runServiceSubscriptionWorkflow(imageSource = DEFAULT_IMAGE_URL, count = 1) {
    logger.info(`Bắt đầu quy trình đăng ký dịch vụ cho ${count} dịch vụ`);
    const results = [];
    
    try {
      for (let i = 1; i <= count; i++) {
        logger.divider();
        logger.info(`Đang xử lý dịch vụ ${i} trong số ${count}`);
        
        const { sharedObjectId, serviceEntryId } = await this.addServiceEntry(10, 60000000);
        const blobId = await this.uploadBlob(imageSource);
        await this.publishToSubscription(sharedObjectId, serviceEntryId, blobId);
        
        results.push({ sharedObjectId, serviceEntryId, blobId });
      }
      
      logger.divider();
      logger.success(`Service registration process completed successfully`);
      return results;
    } catch (error) {
      logger.error(`Service registration process failed: ${error.message}`);
      throw error;
    }
  }
}

class WalletManager {
  constructor(walletFilePath) {
    this.walletFilePath = walletFilePath;
    this.wallets = [];
    this.loadWallets();
  }

  loadWallets() {
    try {
      if (fs.existsSync(this.walletFilePath)) {
        const walletData = fs.readFileSync(this.walletFilePath, 'utf8');
        this.wallets = walletData
          .split('\n')
          .map(phrase => phrase.trim())
          .filter(phrase => phrase && !phrase.startsWith('#'));
        
        logger.success(`Loaded ${this.wallets.length} wallet from ${this.walletFilePath}`);
      } else {
        logger.warning(`Wallet file not found ${this.walletFilePath}.`);
        this.wallets = [];
      }
    } catch (error) {
      logger.error(`Error loading wallet: ${error.message}`);
      this.wallets = [];
    }
  }

  getWallets() {
    return this.wallets;
  }

  hasWallets() {
    return this.wallets.length > 0;
  }
}
(function () {
    const colors = {
        reset: "\x1b[0m",
        bright: "\x1b[1m",
        dim: "\x1b[2m",
        underscore: "\x1b[4m",
        blink: "\x1b[5m",
        reverse: "\x1b[7m",
        hidden: "\x1b[8m",
        black: "\x1b[30m",
        red: "\x1b[31m",
        green: "\x1b[32m",
        yellow: "\x1b[33m",
        blue: "\x1b[34m",
        magenta: "\x1b[35m",
        cyan: "\x1b[36m",
        white: "\x1b[37m",
        bgBlack: "\x1b[40m",
        bgRed: "\x1b[41m",
        bgGreen: "\x1b[42m",
        bgYellow: "\x1b[43m",
        bgBlue: "\x1b[44m",
        bgMagenta: "\x1b[45m",
        bgCyan: "\x1b[46m",
        bgWhite: "\x1b[47m"
    };

const bannerLines = [
    `${colors.bright}${colors.green}░▀▀█░█▀█░▀█▀░█▀█${colors.reset}\n` +
    `${colors.bright}${colors.cyan}░▄▀░░█▀█░░█░░█░█${colors.reset}\n` +
    `${colors.bright}${colors.yellow}░▀▀▀░▀░▀░▀▀▀░▀░▀${colors.reset}`,
        `${colors.bright}${colors.bgBlue}╔══════════════════════════════════╗${colors.reset}`,
        `${colors.bright}${colors.bgBlue}║                                  ║${colors.reset}`,
        `${colors.bright}${colors.bgBlue}║  ${colors.magenta}ZAIN ARAIN                      ${colors.bgBlue}║${colors.reset}`,
        `${colors.bright}${colors.bgBlue}║  ${colors.cyan}AUTO SCRIPT MASTER              ${colors.bgBlue}║${colors.reset}`,
        `${colors.bright}${colors.bgBlue}║                                  ║${colors.reset}`,
        `${colors.bright}${colors.bgBlue}║  ${colors.yellow}JOIN TELEGRAM CHANNEL NOW!      ${colors.bgBlue}║${colors.reset}`,
        `${colors.bright}${colors.bgBlue}║  ${colors.green}https://t.me/AirdropScript6     ${colors.bgBlue}║${colors.reset}`,
        `${colors.bright}${colors.bgBlue}║  ${colors.red}@AirdropScript6 - OFFICIAL      ${colors.bgBlue}║${colors.reset}`,
        `${colors.bright}${colors.bgBlue}║  ${colors.cyan}CHANNEL                         ${colors.bgBlue}║${colors.reset}`,
        `${colors.bright}${colors.bgBlue}║                                  ║${colors.reset}`,
        `${colors.bright}${colors.bgBlue}║  ${colors.green}FAST - RELIABLE - SECURE        ${colors.bgBlue}║${colors.reset}`,
        `${colors.bright}${colors.bgBlue}║  ${colors.yellow}SCRIPTS EXPERT                  ${colors.bgBlue}║${colors.reset}`,
        `${colors.bright}${colors.bgBlue}║                                  ║${colors.reset}`,
        `${colors.bright}${colors.bgBlue}╚══════════════════════════════════╝${colors.reset}`
    ];

    // Print each line separately
    bannerLines.forEach(line => console.log(line));
})();

async function promptUser(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    return new Promise((resolve) => {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });
  } catch (error) {
    rl.close();
    return '';
  }
}

async function main() {
  console.log('\nSUI SEAL AUTO BOT ');
  logger.divider();
  
  const walletPath = path.join(__dirname, 'wallets.txt');
  const proxyPath = path.join(__dirname, 'proxies.txt');
  const pkPath = path.join(__dirname, 'pk.txt');
  
  const proxyManager = new ProxyManager(proxyPath);
  
  const walletManager = new WalletManager(walletPath);
  
  let wallets = [];
  
  if (walletManager.hasWallets()) {
    const useMultipleWallets = await promptUser('\nDetect multiple wallets. Use them? (y/n): ');
    if (useMultipleWallets.toLowerCase() === 'y') {
      wallets = walletManager.getWallets();
      logger.info(`Using ${wallets.length} wallets from wallets.txt`);
    }
  }
  
  if (wallets.length === 0) {
    if (!fs.existsSync(pkPath)) {
      logger.error('Wallet not found. Please create pk.txt with your passphrase or wallets.txt for multiple wallets.');
      process.exit(1);
    }
    const passphrase = fs.readFileSync(pkPath, 'utf8').trim();
    wallets = [passphrase];
    logger.info('Using a single wallet from pk.txt');
  }
  
  logger.divider();
  console.log('Select action:');
  console.log('1. Create whitelist and publish Blob');
  console.log('2. Create service registration and upload Blob');
  const choice = await promptUser('Enter choice (1 or 2): ');
  
  try {
    let imageSource;
    logger.divider();
    console.log('Image source option:');
    console.log('1. Use URL (default: https://picsum.photos/800/600)');
    console.log('2. Use local file (image.jpg in script folder)');
    const imageChoice = await promptUser('Choose image source (1 or 2): ');

    if (imageChoice === '2') {
      if (!fs.existsSync(LOCAL_IMAGE_PATH)) {
        logger.error('Error: image.jpg not found in script folder.');
        process.exit(1);
      }
      imageSource = LOCAL_IMAGE_PATH;
      logger.info('Using local image.jpg');
    } else {
      imageSource = await promptUser('Enter image URL (or press Enter to use default): ') || DEFAULT_IMAGE_URL;
      logger.info(`Using image URL: ${imageSource}`);
    }
    
    const countInput = await promptUser('Enter number of tasks per wallet (default is 1): ');
    let count = parseInt(countInput || '1', 10);
    if (isNaN(count) || count < 1) {
      logger.warning('Invalid number. Using default value of 1.');
      count = 1;
    }
    
    let additionalAddresses = [];
    if (choice === '1') {
      const addressesInput = await promptUser('Enter additional addresses to add to the whitelist (comma-separated, or press Enter if none): ');
      if (addressesInput.trim()) {
        additionalAddresses = addressesInput
          .split(',')
          .map(addr => addr.trim())
          .filter(addr => addr);
        logger.info(`Will add ${additionalAddresses.length} additional addresses to each whitelist`);
      }
    }
    
    for (let i = 0; i < wallets.length; i++) {
      logger.divider();
      logger.wallet(`Processing wallet ${i + 1} of ${wallets.length}`);
      
      const bot = new SuiAllowlistBot(wallets[i], proxyManager);
      logger.wallet(`Wallet address: ${bot.getAddress()}`);
      
      if (choice === '1') {
        logger.info(`Starting whitelist workflow (${count} tasks)`);
        const results = await bot.runAllowlistWorkflow(imageSource, additionalAddresses, count);
        
        logger.divider();
        logger.success(`Summary for wallet ${i + 1}:`);
        results.forEach((result, idx) => {
          logger.info(`Whitelist ${idx + 1}:`);
          logger.result('Allowlist ID', result.allowlistId);
          logger.result('Entry ID', result.entryObjectId);
          logger.result('Blob ID', result.blobId);
        });
      } else if (choice === '2') {
        logger.info(`Starting service registration workflow (${count} tasks)`);
        const results = await bot.runServiceSubscriptionWorkflow(imageSource, count);
        
        logger.divider(); 
        logger.success(`Summary for wallet ${i + 1}:`);
        results.forEach((result, idx) => {
          logger.info(`Service ${idx + 1}:`);
          logger.result('Shared ID', result.sharedObjectId);
          logger.result('Service Entry ID', result.serviceEntryId);
          logger.result('Blob ID', result.blobId);
        });
      } else {
        logger.error('Invalid choice. Please enter 1 or 2.');
        break;
      }
    }
    
    logger.divider();
    logger.success('All tasks completed successfully!');
    
  } catch (error) {
    logger.error(`Critical error: ${error.message}`);
  } finally {
    process.exit(0);
  }
}

main();