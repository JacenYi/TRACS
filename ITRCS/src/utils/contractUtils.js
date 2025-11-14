import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';

// ========================= 全局配置与常量 =========================
/** 合约配置常量 */
export const CONTRACT_CONFIG = {
  address: '0x5ba3b2b09a7f81d0a9198587b2fd51f40bb44bec9a7ec3b520b9d81432ec02c0',
  moduleName: 'merchant_payment',
  globalStateId: '0x99c067e70e1da1c51f15ea7a561791e5608dc099ebc1502b92cda97573a4f393',
  fullnodeUrl: getFullnodeUrl('testnet'),
};

/** 合约函数名常量 */
const CONTRACT_METHODS = {
  registerMerchant: 'register_merchant',
  getMerchantAddress: 'get_merchant_address',
  getAllMerchantInfo: 'get_all_merchant_info',
  getMerchantLatestReport: 'get_merchant_latest_report',
  getMerchantLatestTransactions: 'get_merchant_latest_transactions',
  recordMerchantReport: 'record_merchant_report',
  recordMerchantTransaction: 'record_merchant_transaction',
};

/** Sui客户端实例（单例） */
const suiClient = new SuiClient({ url: CONTRACT_CONFIG.fullnodeUrl });

/** 全局钱包状态 */
let walletState = {
  connected: false,
  address: null,
  account: null,
  connect: null,
  disconnect: null,
  signTransaction: null,
  signAndExecuteTransaction: null,
};

// ========================= 基础工具函数 =========================
/**
 * 获取钱包地址（兼容多种钱包格式）
 * @param {Object} wallet - 钱包实例
 * @returns {string|null} 钱包地址
 */
const getWalletAddress = (wallet) => {
  if (!wallet) return null;
  return wallet.address || wallet.account?.address || null;
};

/**
 * 校验钱包连接状态
 * @param {Object} wallet - 钱包实例
 * @throws {Error} 钱包未连接或地址无效时抛出错误
 */
const validateWalletConnection = (wallet) => {
  const address = getWalletAddress(wallet);
  if (!wallet) throw new Error('请先连接钱包');
  if (!address) throw new Error('钱包地址获取失败，请重新连接');
  return address;
};

/**
 * 校验GlobalState配置
 * @throws {Error} 配置无效时抛出错误
 */
const validateGlobalState = () => {
  if (!CONTRACT_CONFIG.globalStateId || CONTRACT_CONFIG.globalStateId === '0x') {
    throw new Error('GlobalState对象ID未配置，请检查合约配置');
  }
};

/**
 * BCS通用反序列化工具
 * @param {any} rawData - 原始数据
 * @param {Object} schema - BCS解析 schema
 * @param {string} type - 数据类型标识
 * @returns {any} 反序列化后的数据
 */
const deserializeBCS = (rawData, schema, type = 'vector') => {
  // 处理 [字节数组, 类型描述] 格式
  let byteData = rawData;
  if (Array.isArray(rawData) && rawData.length === 2 && Array.isArray(rawData[0])) {
    byteData = rawData[0];
  }

  if (!byteData || !Array.isArray(byteData)) return null;

  try {
    const binaryData = new Uint8Array(byteData);
    return type === 'vector' ? schema.parse(binaryData) : schema.parse(binaryData);
  } catch (error) {
    console.warn(`BCS反序列化${type}失败:`, error.message);
    return null;
  }
};

/**
 * 解析ASCII字符串（Sui合约字符串存储格式）
 * @param {any} data - 原始字符串数据
 * @returns {string} 解析后的字符串
 */
const parseAsciiString = (data) => {
  if (typeof data === 'string') return data.trim();
  if (data?.bytes && Array.isArray(data.bytes)) {
    return new TextDecoder('utf-8').decode(new Uint8Array(data.bytes)).trim();
  }
  return '';
};

// ========================= 钱包相关 =========================
/**
 * 钱包Hook - 提供钱包状态和操作方法
 * @returns {Object} 钱包状态和操作方法
 */
export const useWallet = () => walletState;

/**
 * 设置钱包状态 - 用于钱包连接后更新状态
 * @param {Object} wallet - 钱包实例
 */
export const setWalletState = (wallet) => {
  walletState = {
    connected: wallet.connected || false,
    address: getWalletAddress(wallet),
    account: wallet.account || null,
    connect: wallet.connect || null,
    disconnect: wallet.disconnect || null,
    signTransaction: wallet.signTransaction || null,
    signAndExecuteTransaction: wallet.signAndExecuteTransaction || null,
  };
};

// ========================= 合约核心方法 =========================
/**
 * 从合约获取所有商户信息
 * @param {Object} wallet - 钱包实例
 * @param {string} contractAddress - 合约地址（默认使用全局配置）
 * @returns {Promise<Array>} 格式化后的商户信息数组
 */
export const getAllMerchantInfo = async (wallet, contractAddress = CONTRACT_CONFIG.address) => {
  try {
    validateGlobalState();

    // 构建交易
    const tx = new Transaction();
    tx.moveCall({
      target: `${contractAddress}::${CONTRACT_CONFIG.moduleName}::${CONTRACT_METHODS.getAllMerchantInfo}`,
      arguments: [tx.object(CONTRACT_CONFIG.globalStateId)],
    });

    // 执行查询
    const sender = getWalletAddress(wallet) || '0x0000000000000000000000000000000000000000000000000000000000000000';
    const result = await suiClient.devInspectTransactionBlock({ transactionBlock: tx, sender });

    // 解析返回结果
    const rawData = result?.results?.[0]?.returnValues?.[0];
    if (!rawData) throw new Error('商户信息获取失败，返回数据为空');

    // 定义BCS解析结构
    const ASCIIString = bcs.struct('ASCIIString', { bytes: bcs.vector(bcs.u8()) });
    const MerchantInfo = bcs.struct('MerchantInfo', {
      blob_id: ASCIIString,
      name: ASCIIString,
      industry: ASCIIString,
      address: bcs.Address,
    });

    const merchants = deserializeBCS(rawData, bcs.vector(MerchantInfo)) || [];
    if (!Array.isArray(merchants)) throw new Error('商户信息格式解析失败');

    // 行业图标映射
    const getIndustryIcon = (industry) => {
      if (!industry) return '🏪';
      const lowerIndustry = industry.toLowerCase();
      const iconMap = [
        { keywords: ['电商', '购物'], icon: '🛒' },
        { keywords: ['餐饮', '咖啡', '食品'], icon: '☕' },
        { keywords: ['游戏', '娱乐'], icon: '🎮' },
        { keywords: ['金融', '银行'], icon: '🏦' },
        { keywords: ['医疗', '健康'], icon: '🏥' },
        { keywords: ['教育', '学校'], icon: '🎓' },
        { keywords: ['交通', '物流'], icon: '🚚' },
      ];
      return iconMap.find(item => item.keywords.some(k => lowerIndustry.includes(k)))?.icon || '🏪';
    };

    // 格式化返回数据
    return merchants.map(item => {
      const industry = parseAsciiString(item.industry);
      return {
        icon: getIndustryIcon(industry),
        name: parseAsciiString(item.name) || '未知商户',
        description: `${industry || '未知行业'}·${parseAsciiString(item.name) || '未知商户'}`,
        industryType: industry,
        blobId: parseAsciiString(item.blob_id),
        contractAddress: item.address || '',
        address: item.address || '',
      };
    });
  } catch (error) {
    console.error('获取所有商户信息失败:', error);
    return [];
  }
};

/**
 * 注册商户到SUI合约
 * @param {Object} params - 注册参数
 * @param {string} params.blobId - 商户数据的blob_id
 * @param {string} params.name - 商户名称
 * @param {string} params.industry - 商户行业类型
 * @param {string} params.merchantAddress - 商户地址
 * @param {Object} wallet - 钱包实例
 * @param {string} contractAddress - 合约地址（默认使用全局配置）
 * @returns {Promise<Object>} 交易结果
 */


export const registerMerchant = async (
  blobId,
  name,
  industry,
  merchantAddress,
  wallet,
  contractAddress = CONTRACT_CONFIG.address
) => {
  try {
    // 参数校验
    if (!blobId || !name || !industry || !merchantAddress) {
      throw new Error('注册参数不能为空');
    }
    const walletAddress = validateWalletConnection(wallet);
    validateGlobalState();

    // 构建交易
    const tx = new Transaction();
    tx.setSender(walletAddress);
    tx.moveCall({
      target: `${contractAddress}::${CONTRACT_CONFIG.moduleName}::${CONTRACT_METHODS.registerMerchant}`,
      arguments: [
        tx.pure.string(blobId),
        tx.pure.string(name),
        tx.pure.string(industry),
        tx.pure.address(merchantAddress),
        tx.object(CONTRACT_CONFIG.globalStateId),
      ],
    });

    // 签名并执行交易
    if (typeof wallet.signAndExecuteTransaction !== 'function') {
      throw new Error('钱包不支持交易签名功能');
    }

    const result = await wallet.signAndExecuteTransaction({
      transaction: tx,
      options: { showEffects: true, showEvents: true },
    });

    return {
      success: true,
      transactionId: result.digest || result.transactionId,
      name,
      blobId,
      industry,
      merchantAddress,
      timestamp: new Date().toISOString(),
      rawResult: result,
    };
  } catch (error) {
    console.error('注册商户失败:', error);
    throw new Error(`商户注册失败: ${error.message}`);
  }
};

/**
 * 记录商户交易
 * @param {Object} params - 交易参数
 * @param {string} params.merchantBlobId - 商户的blob_id
 * @param {string} params.transactionBlobId - 交易的blob_id
 * @param {Object} wallet - 钱包实例
 * @param {string} contractAddress - 合约地址（默认使用全局配置）
 * @returns {Promise<Object>} 交易结果
 */
export const recordMerchantTransaction = async (
  merchantBlobId,
  transactionBlobId,
  wallet,
  contractAddress = CONTRACT_CONFIG.address
) => {
  try {
    if (!merchantBlobId || !transactionBlobId) {
      throw new Error('交易参数不能为空');
    }
    const walletAddress = validateWalletConnection(wallet);
    validateGlobalState();

    const tx = new Transaction();
    tx.setSender(walletAddress);
    tx.moveCall({
      target: `${contractAddress}::${CONTRACT_CONFIG.moduleName}::${CONTRACT_METHODS.recordMerchantTransaction}`,
      arguments: [
        tx.pure.string(merchantBlobId),
        tx.pure.string(transactionBlobId),
        tx.object(CONTRACT_CONFIG.globalStateId),
      ],
    });

    if (typeof wallet.signAndExecuteTransaction !== 'function') {
      throw new Error('钱包不支持交易签名功能');
    }

    const result = await wallet.signAndExecuteTransaction({
      transaction: tx,
      options: { showEffects: true, showEvents: true },
    });

    return {
      success: true,
      transactionId: result.digest || result.transactionId,
      merchantBlobId,
      transactionBlobId,
      timestamp: new Date().toISOString(),
      rawResult: result,
    };
  } catch (error) {
    console.error('记录商户交易失败:', error);
    throw error;
  }
};

/**
 * 记录商户报告
 * @param {Object} params - 报告参数
 * @param {string} params.merchantBlobId - 商户的blob_id
 * @param {string} params.reportBlobId - 报告的blob_id
 * @param {Object} wallet - 钱包实例
 * @param {string} contractAddress - 合约地址（默认使用全局配置）
 * @returns {Promise<Object>} 交易结果
 */
export const recordMerchantReport = async (
  merchantBlobId,
  reportBlobId ,
  wallet,
  contractAddress = CONTRACT_CONFIG.address
) => {
  console.log('记录商户报告参数:', { merchantBlobId, reportBlobId });
  
  try {
    if (!merchantBlobId || !reportBlobId) {
      throw new Error('报告参数不能为空');
    }
    const walletAddress = validateWalletConnection(wallet);
    validateGlobalState();

    const tx = new Transaction();
    tx.setSender(walletAddress);
    tx.moveCall({
      target: `${contractAddress}::${CONTRACT_CONFIG.moduleName}::${CONTRACT_METHODS.recordMerchantReport}`,
      arguments: [
        tx.pure.string(merchantBlobId),
        tx.pure.string(reportBlobId),
        tx.object(CONTRACT_CONFIG.globalStateId),
      ],
    });

    if (typeof wallet.signAndExecuteTransaction !== 'function') {
      throw new Error('钱包不支持交易签名功能');
    }

    const result = await wallet.signAndExecuteTransaction({
      transaction: tx,
      options: { showEffects: true, showEvents: true },
    });

    return {
      success: true,
      transactionId: result.digest || result.transactionId,
      merchantBlobId,
      reportBlobId,
      timestamp: new Date().toISOString(),
      rawResult: result,
    };
  } catch (error) {
    console.error('记录商户报告失败:', error);
    throw error;
  }
};

/**
 * 根据商户名称获取商户地址
 * @param {string} merchantName - 商户名称
 * @param {Object} wallet - 钱包实例
 * @param {string} contractAddress - 合约地址（默认使用全局配置）
 * @returns {Promise<string|null>} 商户地址
 */
export const getMerchantAddress = async (merchantName, wallet, contractAddress = CONTRACT_CONFIG.address) => {
  try {
    if (!merchantName) throw new Error('商户名称不能为空');
    const walletAddress = validateWalletConnection(wallet);
    validateGlobalState();

    const tx = new Transaction();
    tx.moveCall({
      target: `${contractAddress}::${CONTRACT_CONFIG.moduleName}::${CONTRACT_METHODS.getMerchantAddress}`,
      arguments: [tx.pure.string(merchantName), tx.object(CONTRACT_CONFIG.globalStateId)],
    });

    const result = await suiClient.devInspectTransactionBlock({ transactionBlock: tx, sender: walletAddress });
    const rawData = result?.results?.[0]?.returnValues?.[0];
    if (!rawData) throw new Error('未查询到商户地址');

    // 解析地址
    const address = deserializeBCS(rawData, bcs.vector(bcs.Address));
    return Array.isArray(address) && address.length > 0 ? address[0] : address || null;
  } catch (error) {
    console.error('获取商户地址失败:', error);
    throw new Error(`获取商户地址失败: ${error.message}`);
  }
};

/**
 * 获取商户最新交易
 * @param {string} blobId - 商户的blob_id
 * @param {Object} wallet - 钱包实例
 * @param {string} contractAddress - 合约地址（默认使用全局配置）
 * @returns {Promise<Array>} 最新交易blob_id数组
 */
export const getMerchantLatestTransactions = async (blobId, wallet, contractAddress = CONTRACT_CONFIG.address) => {
  try {
    if (!blobId) throw new Error('商户blob_id不能为空');
    const walletAddress = validateWalletConnection(wallet);
    validateGlobalState();

    const tx = new Transaction();
    tx.moveCall({
      target: `${contractAddress}::${CONTRACT_CONFIG.moduleName}::${CONTRACT_METHODS.getMerchantLatestTransactions}`,
      arguments: [tx.pure.string(blobId), tx.object(CONTRACT_CONFIG.globalStateId)],
    });

    const result = await suiClient.devInspectTransactionBlock({ transactionBlock: tx, sender: walletAddress });
    const rawData = result?.results?.[0]?.returnValues?.[0];
    if (!rawData) return [];

    // 解析交易数据（支持字符串向量和ASCII字符串向量）
    const ASCIIString = bcs.struct('ASCIIString', { bytes: bcs.vector(bcs.u8()) });
    
    // 尝试两种解析方式
    let transactions = deserializeBCS(rawData, bcs.vector(bcs.string));
    if (!transactions) {
      const asciiData = deserializeBCS(rawData, bcs.vector(ASCIIString));
      transactions = asciiData ? asciiData.map(parseAsciiString) : [];
    }

    // 过滤有效交易
    return (Array.isArray(transactions) ? transactions : [])
      .map(tx => parseAsciiString(tx))
      .filter(tx => tx);
  } catch (error) {
    console.error('获取商户最新交易失败:', error);
    throw new Error(`获取商户最新交易失败: ${error.message}`);
  }
};

/**
 * 获取商户最新报告
 * @param {string} blobId - 商户的blob_id
 * @param {Object} wallet - 钱包实例
 * @param {string} contractAddress - 合约地址（默认使用全局配置）
 * @returns {Promise<Object|null>} 最新报告信息（无报告返回null）
 */
export const getMerchantLatestReport = async (blobId, wallet, contractAddress = CONTRACT_CONFIG.address) => {
  try {
    if (!blobId) throw new Error('商户blob_id不能为空');
    const walletAddress = validateWalletConnection(wallet);
    validateGlobalState();

    const tx = new Transaction();
    tx.moveCall({
      target: `${contractAddress}::${CONTRACT_CONFIG.moduleName}::${CONTRACT_METHODS.getMerchantLatestReport}`,
      arguments: [tx.pure.string(blobId), tx.object(CONTRACT_CONFIG.globalStateId)],
    });

    const result = await suiClient.devInspectTransactionBlock({ transactionBlock: tx, sender: walletAddress });
    const rawData = result?.results?.[0]?.returnValues?.[0];
    
    // 处理无报告场景
    if (!rawData || 
        (Array.isArray(rawData) && rawData.length === 0) ||
        (Array.isArray(rawData) && rawData.length === 2 && !rawData[0]) ||
        (typeof rawData === 'string' && rawData.trim() === '')) {
      return null;
    }

    // 解析报告ID
    const ASCIIString = bcs.struct('ASCIIString', { bytes: bcs.vector(bcs.u8()) });
    let reportBlobId = deserializeBCS(rawData, bcs.string);
    
    if (!reportBlobId) {
      const asciiData = deserializeBCS(rawData, ASCIIString);
      reportBlobId = asciiData ? parseAsciiString(asciiData) : null;
    }

    if (!reportBlobId || reportBlobId.trim() === '') return null;

    return {
      blobId: reportBlobId.trim(),
      merchantBlobId: blobId,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('获取商户最新报告失败:', error);
    const errorMsg = error.message || '';
    // 特定无报告错误返回null
    if (errorMsg.includes('不存在') || errorMsg.includes('未找到') || errorMsg.includes('暂无报告')) {
      return null;
    }
    throw new Error(`获取商户最新报告失败: ${error.message}`);
  }
};

/**
 * 别名函数：获取商户交易信息
 * @param {string} blobId - 商户的blob_id
 * @param {Object} wallet - 钱包实例
 * @param {string} contractAddress - 合约地址（默认使用全局配置）
 * @returns {Promise<Array>} 交易信息数组
 */
export const fetchMerchantTransactions = async (blobId, wallet, contractAddress = CONTRACT_CONFIG.address) => {
  try {
    validateWalletConnection(wallet);
    return await getMerchantLatestTransactions(blobId, wallet, contractAddress);
  } catch (error) {
    console.error('获取商户交易信息失败:', error);
    throw new Error(`获取商户交易信息失败: ${error.message}`);
  }
};

/**
 * 别名函数：获取商户风险报告
 * @param {string} merchantBlobId - 商户的blob_id
 * @param {Object} wallet - 钱包实例
 * @param {string} contractAddress - 合约地址（默认使用全局配置）
 * @returns {Promise<Object|null>} 风险报告信息
 */
export const fetchMerchantRiskReport = async (merchantBlobId, wallet, contractAddress = CONTRACT_CONFIG.address) => {
  return await getMerchantLatestReport(merchantBlobId, wallet, contractAddress);
};

// ========================= 导出模块 =========================
export default {
  registerMerchant,
  getMerchantAddress,
  getAllMerchantInfo,
  getMerchantLatestTransactions,
  getMerchantLatestReport,
  recordMerchantReport,
  recordMerchantTransaction,
  useWallet,
  setWalletState,
  fetchMerchantRiskReport,
  fetchMerchantTransactions,
  CONTRACT_CONFIG, // 导出配置供外部使用
};