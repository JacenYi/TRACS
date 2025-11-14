import axios from 'axios';

// Walrus API配置常量
const WALRUS_PUBLISHER_URL = 'https://publisher.walrus-testnet.walrus.space';
const WALRUS_AGGREGATOR_URL = 'https://aggregator.walrus-testnet.walrus.space';

/**
 * 上传文件到Walrus
 * @param {File} file - 要上传的文件对象
 * @param {Object} wallet - 钱包对象（用于检查连接状态）
 * @param {number} epochs - 存储周期数量，默认1
 * @param {string} sendTo - 可选的接收地址
 * @param {Function} onProgress - 可选的进度回调函数
 * @returns {Promise<string>} 返回上传后的blob_id
 */
export const uploadFile = async (file, wallet, epochs = 53, sendTo = '', onProgress = null) => {  
  // 检查钱包是否已连接
  if (!wallet || !wallet.connected) {
    throw new Error('请先连接SUI钱包以授权上传操作');
  }
  
  try {
    // 确保epochs是数字类型
    const epochsNum = Number(epochs);
    if (isNaN(epochsNum) || epochsNum <= 0) {
      throw new Error('epochs参数必须是大于0的数字');
    }
    
    // 构建查询参数
    let queryParams = `epochs=${epochsNum}`;
    if (sendTo) {
      queryParams += `&send_object_to=${sendTo}`;
    }
    
    // 使用axios调用Walrus上传API（文件上传）- 使用PUT请求直接发送文件内容
    const response = await axios({
      method: 'put',
      url: `${WALRUS_PUBLISHER_URL}/v1/blobs?${queryParams}`,
      data: file, // 直接使用文件对象作为请求体
      headers: {
          'Content-Type': file.type || 'application/octet-stream'
        },
      withCredentials: false,
      timeout: 30000, // 增加超时时间
      // 添加上传进度监控
      onUploadProgress: (progressEvent) => {
        if (progressEvent.total && onProgress && typeof onProgress === 'function') {
          const percentComplete = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          onProgress(percentComplete);
        }
      }
    });
        
    // 处理响应格式 - 支持两种成功响应格式
    let blobId;
    if (response.data.alreadyCertified) {
      // 已认证的blob
      blobId = response.data.alreadyCertified.blobId;
    } else if (response.data.newlyCreated) {
      // 新创建的blob
      blobId = response.data.newlyCreated.blobObject.blobId;
    } else {
      throw new Error('服务器返回的响应格式不正确，无法解析blobId');
    }
    
    return blobId;
  } catch (error) {
    console.error('Walrus文件上传错误:', error);
    
    // 增强错误信息处理
    if (error.response) {
      const errorMsg = `文件上传失败: ${error.response.status} ${error.response.statusText}`;
      const errorData = error.response.data;
      if (errorData) {
        throw new Error(`${errorMsg} - ${typeof errorData === 'string' ? errorData : JSON.stringify(errorData)}`);
      }
      throw new Error(errorMsg);
    } else if (error.request) {
      throw new Error('文件上传失败: 服务器无响应，请检查网络连接和API端点是否可用');
    } else {
      throw new Error(`文件上传失败: ${error.message}`);
    }
  }
};

/**
 * 上传文本内容到Walrus
 * @param {string} content - 要上传的文本内容
 * @param {Object} wallet - 钱包对象（用于检查连接状态）
 * @param {string} fileName - 文件名，默认content.txt
 * @param {number} epochs - 存储周期数量，默认1
 * @param {string} sendTo - 可选的接收地址
 * @param {Function} onProgress - 可选的进度回调函数
 * @returns {Promise<string>} 返回上传后的blob_id
 */
export const uploadContent = async (content, wallet, fileName = 'content.txt', epochs = 1, sendTo = '', onProgress = null) => {  
  // 检查钱包是否已连接
  if (!wallet || !wallet.connected) {
    throw new Error('请先连接SUI钱包以授权上传操作');
  }
  
  // 创建Blob对象
  const blob = new Blob([content], { type: 'text/plain' });
  
  // 创建File对象
  const file = new File([blob], fileName, { type: 'text/plain' });
  
  // 调用文件上传方法
  return await uploadFile(file, wallet, epochs, sendTo, onProgress);
};

/**
 * 从Walrus获取内容
 * @param {string} blobId - 要获取的内容的blob_id
 * @returns {Promise<Object>} 返回包含内容和元数据的对象
 */
export const getContent = async (blobId) => {  
  try {
    // 使用axios调用Walrus aggregator API直接获取内容
    const response = await axios({
      method: 'get',
      url: `${WALRUS_AGGREGATOR_URL}/v1/blobs/${blobId}`,
      withCredentials: false,
      timeout: 10000 // 设置10秒超时
    });
    
    
    // 直接返回响应数据，不做类型判断
    return {
      blobId: blobId,
      content: response.data,
      timestamp: new Date().toISOString(),
      metadata: {
        size: response.headers['content-length'] || 0,
        type: response.headers['content-type'] || 'application/octet-stream'
      }
    };
  } catch (error) {
    console.error('Walrus获取内容错误:', error);
    
    // 增强错误信息处理
    if (error.response) {
      if (error.response.status === 404) {
        throw new Error('未找到指定的内容');
      }
      const errorMsg = `获取内容失败: ${error.response.status} ${error.response.statusText}`;
      throw new Error(errorMsg);
    } else if (error.request) {
      // 请求已发送但没有收到响应
      throw new Error('获取内容失败: 服务器无响应，请检查网络连接和API端点是否可用');
    } else {
      // 请求配置出错
      throw new Error(`获取内容失败: ${error.message}`);
    }
  }
};

// 导出默认对象，支持两种导入方式
export default {
  uploadFile,
  uploadContent,
  getContent
};