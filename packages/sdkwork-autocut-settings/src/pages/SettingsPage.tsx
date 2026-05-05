import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Card, Button, useToast } from '@sdkwork/autocut-commons';
import { User, Bell, Shield, CreditCard, Key, Database, Crown, Zap, Monitor, BrainCircuit } from 'lucide-react';
import {
  cancelAutoCutSubscription,
  clearAutoCutStorageCache,
  createAutoCutApiKey,
  deleteAutoCutAccount,
  getAutoCutSettings,
  listenAutoCutEvent,
  loadMoreAutoCutInvoices,
  openAutoCutSubscriptionManagement,
  requestAutoCutAvatarChange,
  requestAutoCutPasswordChange,
  revokeAutoCutApiKey,
  revokeAutoCutSessions,
  saveAutoCutAccountSettings,
  saveAutoCutLlmSettings,
  saveAutoCutNotificationSettings,
  saveAutoCutSpeechTranscriptionSettings,
  saveAutoCutWorkspaceSettings,
  selectAutoCutSpeechTranscriptionFile,
  selectAutoCutTrustedLocalDirectory,
  setAutoCutTwoFactorEnabled,
  testAutoCutLlmConnection,
  testAutoCutSpeechTranscriptionToolchain,
  writeAutoCutClipboardText,
} from '@sdkwork/autocut-services';
import { AUTOCUT_MODEL_VENDOR_PRESETS, getAutoCutModelPreset } from '@sdkwork/autocut-types';
import type { AppSettings, AutoCutLlmSettings, ModelVendor } from '@sdkwork/autocut-types';

function getAutoCutAccountInitials(displayName: string) {
  const initials = displayName.trim().slice(0, 2).toUpperCase();
  return initials || 'US';
}

function formatAutoCutTokenCount(tokens: number) {
  return String(Math.round(tokens)).replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
}

export function SettingsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryParams = new URLSearchParams(location.search);
  const tabFromUrl = queryParams.get('tab') || 'account';

  const [activeTab, setActiveTab] = useState(tabFromUrl);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [isTestingLlmConnection, setIsTestingLlmConnection] = useState(false);
  const [isTestingSpeechTranscription, setIsTestingSpeechTranscription] = useState(false);

  useEffect(() => {
    setActiveTab(tabFromUrl);
  }, [tabFromUrl]);

  useEffect(() => {
    getAutoCutSettings().then(setSettings);
    return listenAutoCutEvent('settingsUpdated', setSettings);
  }, []);

  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId);
    navigate(`/settings?tab=${tabId}`, { replace: true });
  };

  const updateSettingsState = (nextSettings: AppSettings) => {
    setSettings(nextSettings);
  };

  const handleSaveAccount = async () => {
    if (!settings) return;
    updateSettingsState(await saveAutoCutAccountSettings(settings.account));
    toast('账号信息已保存', 'success');
  };

  const handleSaveWorkspace = async () => {
    if (!settings) return;
    updateSettingsState(await saveAutoCutWorkspaceSettings(settings.workspace));
    toast('工作区偏好已保存', 'success');
  };

  const handleSaveNotifications = async () => {
    if (!settings) return;
    updateSettingsState(await saveAutoCutNotificationSettings(settings.notifications));
    toast('通知设置已保存', 'success');
  };

  const handleChangeAvatar = async () => {
    updateSettingsState(await requestAutoCutAvatarChange());
    toast('头像更新流程已提交', 'info');
  };

  const handleWorkspacePreferenceChange = (workspace: AppSettings['workspace']) => {
    if (!settings) return;
    setSettings({ ...settings, workspace });
    void saveAutoCutWorkspaceSettings(workspace).then(updateSettingsState);
  };

  const handleNotificationPreferenceChange = (notifications: AppSettings['notifications']) => {
    if (!settings) return;
    setSettings({ ...settings, notifications });
    void saveAutoCutNotificationSettings(notifications).then(updateSettingsState);
  };

  const handleLlmSettingsChange = (llm: AutoCutLlmSettings) => {
    if (!settings) return;
    setSettings({ ...settings, llm });
  };

  const handleSpeechTranscriptionSettingsChange = (speechTranscription: AppSettings['speechTranscription']) => {
    if (!settings) return;
    setSettings({ ...settings, speechTranscription });
  };

  const handleLlmVendorChange = (modelVendor: ModelVendor) => {
    if (!settings) return;
    const preset = AUTOCUT_MODEL_VENDOR_PRESETS[modelVendor];
    const nextLlm: AutoCutLlmSettings = {
      ...settings.llm,
      modelVendor,
      baseUrl: modelVendor === 'custom' ? settings.llm.baseUrl : preset.baseUrl,
      model: modelVendor === 'custom' ? settings.llm.model : preset.defaultModel,
    };
    handleLlmSettingsChange(nextLlm);
    void saveAutoCutLlmSettings(nextLlm).then(updateSettingsState);
  };

  const handleSaveLlmSettings = async () => {
    if (!settings) return;
    updateSettingsState(await saveAutoCutLlmSettings(settings.llm));
    toast('LLM 配置已保存', 'success');
  };

  const handleSaveSpeechTranscriptionSettings = async () => {
    if (!settings) return;
    updateSettingsState(await saveAutoCutSpeechTranscriptionSettings(settings.speechTranscription));
    toast('Local speech-to-text settings saved', 'success');
  };

  const handleSelectSpeechTranscriptionFile = async (kind: 'executable' | 'model') => {
    if (!settings) return;
    const selectedPath = await selectAutoCutSpeechTranscriptionFile(kind);
    if (!selectedPath) return;
    const speechTranscription = {
      ...settings.speechTranscription,
      ...(kind === 'executable' ? { executablePath: selectedPath } : { modelPath: selectedPath }),
    };
    updateSettingsState(await saveAutoCutSpeechTranscriptionSettings(speechTranscription));
    toast('Local speech-to-text path updated', 'success');
  };

  const handleTestSpeechTranscriptionToolchain = async () => {
    if (!settings || isTestingSpeechTranscription) return;
    setIsTestingSpeechTranscription(true);
    try {
      updateSettingsState(await saveAutoCutSpeechTranscriptionSettings(settings.speechTranscription));
      const result = await testAutoCutSpeechTranscriptionToolchain();
      toast(`Local speech-to-text test passed: ${result.sourceKind}`, 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Local speech-to-text test failed';
      toast(message, 'error');
    } finally {
      setIsTestingSpeechTranscription(false);
    }
  };

  const handleTestLlmConnection = async () => {
    if (!settings || isTestingLlmConnection) return;
    setIsTestingLlmConnection(true);
    try {
      updateSettingsState(await saveAutoCutLlmSettings(settings.llm));
      const result = await testAutoCutLlmConnection();
      toast(`LLM 测试连接成功：${result.model}`, 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'LLM 测试连接失败';
      toast(message, 'error');
    } finally {
      setIsTestingLlmConnection(false);
    }
  };

  const handleChangeDirectory = async () => {
    if (!settings) return;
    const selectedDirectory = await selectAutoCutTrustedLocalDirectory();
    if (!selectedDirectory) return;
    updateSettingsState(await saveAutoCutWorkspaceSettings({ ...settings.workspace, defaultStoragePath: selectedDirectory }));
    toast('默认目录已更新', 'success');
  };

  const handleChangeOutputDirectory = async () => {
    if (!settings) return;
    const selectedDirectory = await selectAutoCutTrustedLocalDirectory();
    if (!selectedDirectory) return;
    updateSettingsState(await saveAutoCutWorkspaceSettings({ ...settings.workspace, outputDirectory: selectedDirectory }));
    toast('输出目录已更新', 'success');
  };

  const handleCreateApiKey = async () => {
    updateSettingsState(await createAutoCutApiKey());
    toast('API Key 已创建', 'success');
  };

  const handleCopyApiKey = async (maskedKey: string) => {
    await writeAutoCutClipboardText(maskedKey);
    toast('API Key 已复制', 'success');
  };

  const handleRevokeApiKey = async (apiKeyId: string) => {
    updateSettingsState(await revokeAutoCutApiKey(apiKeyId));
    toast('API Key 已撤销', 'success');
  };

  const handleClearCache = async () => {
    updateSettingsState(await clearAutoCutStorageCache());
    toast('缓存已清理', 'success');
  };

  const handleLoadMoreInvoices = async () => {
    updateSettingsState(await loadMoreAutoCutInvoices());
    toast('账单记录已加载', 'success');
  };

  const handleCancelSubscription = async () => {
    updateSettingsState(await cancelAutoCutSubscription());
    toast('订阅状态已更新', 'info');
  };

  const handleManageSubscription = async () => {
    updateSettingsState(await openAutoCutSubscriptionManagement());
    handleTabChange('billing');
    toast('已打开订阅管理', 'info');
  };

  const handleChangePassword = async () => {
    updateSettingsState(await requestAutoCutPasswordChange());
    toast('密码更新流程已启动', 'info');
  };

  const handleToggleTwoFactor = async () => {
    if (!settings) return;
    updateSettingsState(await setAutoCutTwoFactorEnabled(!settings.security.twoFactorEnabled));
    toast('两步验证状态已更新', 'success');
  };

  const handleRevokeSessions = async () => {
    updateSettingsState(await revokeAutoCutSessions());
    toast('其他设备会话已退出', 'success');
  };

  const handleDeleteAccount = async () => {
    updateSettingsState(await deleteAutoCutAccount());
    toast('账号注销申请已记录', 'info');
  };

  if (!settings) {
    return (
      <div className="w-full h-full p-6 md:p-10 overflow-y-auto bg-gradient-to-br from-[#050505] to-[#0A0A0A] text-gray-200">
        <div className="h-full min-h-[240px] flex items-center justify-center text-gray-500">加载配置...</div>
      </div>
    );
  }

  const activeLlmModelPreset = getAutoCutModelPreset(settings.llm.modelVendor, settings.llm.model);
  const tabs = [
    { id: 'speech', label: 'Local Speech-to-Text', icon: <Monitor size={16} /> },
    { id: 'account', label: '账号设置', icon: <User size={16} /> },
    { id: 'workspace', label: '工作区偏好', icon: <Monitor size={16} /> },
    { id: 'billing', label: '订阅与账单', icon: <CreditCard size={16} /> },
    { id: 'api', label: 'API Keys', icon: <Key size={16} /> },
    { id: 'llm', label: 'LLM 配置', icon: <BrainCircuit size={16} /> },
    { id: 'storage', label: '存储管理', icon: <Database size={16} /> },
    { id: 'notifications', label: '通知设置', icon: <Bell size={16} /> },
    { id: 'security', label: '安全与隐私', icon: <Shield size={16} /> },
  ];

  return (
    <div className="w-full h-full p-6 md:p-10 overflow-y-auto bg-gradient-to-br from-[#050505] to-[#0A0A0A] text-gray-200">
      <div className="w-full space-y-8">

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-white mb-2">配置中心</h1>
            <p className="text-gray-400 text-sm">管理您的账户偏好、订阅状态和工作区设置。</p>
          </div>
        </div>

        <div className="flex flex-col md:flex-row gap-8">
          {/* Sidebar */}
          <div className="w-full md:w-64 shrink-0 space-y-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${
                  activeTab === tab.id
                    ? 'bg-blue-600/10 text-blue-500 border border-blue-500/20'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-[#111] border border-transparent'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {/* Main Content */}
          <div className="flex-1 space-y-6">
            {activeTab === 'account' && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
                <Card className="p-6 md:p-8 bg-[#0A0A0A] border-[#222]">
                  <h3 className="text-lg font-semibold text-white border-b border-[#222] pb-4 mb-6">个人信息</h3>
                  <div className="flex items-center gap-6 mb-8">
                    <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-2xl font-bold text-white shadow-lg border-2 border-[#333]">
                      {getAutoCutAccountInitials(settings.account.displayName)}
                    </div>
                    <div>
                      <h4 className="text-xl font-bold text-gray-100 flex items-center gap-2">
                        {settings.account.displayName}
                        <span className="px-2 py-0.5 rounded text-[10px] bg-yellow-500/10 text-yellow-500 border border-yellow-500/20 flex items-center gap-1 font-mono uppercase tracking-wider">
                          <Crown size={12} /> PRO
                        </span>
                      </h4>
                      <p className="text-gray-500 text-sm mt-1">{settings.account.email}</p>
                      <Button onClick={handleChangeAvatar} size="sm" variant="outline" className="mt-3 border-[#333] hover:border-gray-400 text-xs">
                        更换头像
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-xs text-gray-500 uppercase tracking-wider font-semibold">昵称</label>
                      <input type="text" value={settings.account.displayName} onChange={(event) => setSettings({ ...settings, account: { ...settings.account, displayName: event.target.value } })} className="w-full h-10 bg-[#111] border border-[#333] rounded-md px-3 text-sm focus:outline-none focus:border-blue-500 text-gray-200 transition-colors" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs text-gray-500 uppercase tracking-wider font-semibold">联系邮箱</label>
                      <input type="email" value={settings.account.email} onChange={(event) => setSettings({ ...settings, account: { ...settings.account, email: event.target.value } })} className="w-full h-10 bg-[#111] border border-[#333] rounded-md px-3 text-sm focus:outline-none focus:border-blue-500 text-gray-200 transition-colors" />
                    </div>
                  </div>
                  <div className="mt-6 flex justify-end">
                    <Button onClick={handleSaveAccount} className="bg-blue-600 hover:bg-blue-500 text-white">保存修改</Button>
                  </div>
                </Card>
              </div>
            )}

            {activeTab === 'billing' && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
                <Card className="p-0 overflow-hidden border border-yellow-500/30 bg-gradient-to-br from-[#1A1A10] to-[#0A0A0A]">
                  <div className="p-8 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-yellow-500/10 rounded-full blur-[80px]" />
                    <div className="flex justify-between items-start relative z-10">
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <Crown size={24} className="text-yellow-500" />
                          <h3 className="text-2xl font-bold text-white">{settings.billing.planName}</h3>
                        </div>
                        <p className="text-gray-400 text-sm">解锁极致渲染性能与全部高级切片权益</p>
                      </div>
                      <div className="text-right">
                        <div className="text-3xl font-extrabold text-white">￥{settings.billing.monthlyPrice}<span className="text-sm font-medium text-gray-400">/月</span></div>
                        <p className="text-xs text-gray-500 mt-1">下次扣费日期: {settings.billing.nextBillingDate}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-10 relative z-10">
                      <div className="bg-[#111]/80 backdrop-blur rounded-lg p-5 border border-[#333]">
                        <Zap size={20} className="text-yellow-500 mb-3" />
                        <h4 className="font-semibold text-gray-200 mb-1">极速渲染列队</h4>
                        <p className="text-xs text-gray-500 leading-relaxed">专享GPU推理集群，任务处理提速 400%</p>
                      </div>
                      <div className="bg-[#111]/80 backdrop-blur rounded-lg p-5 border border-[#333]">
                        <Database size={20} className="text-blue-500 mb-3" />
                        <h4 className="font-semibold text-gray-200 mb-1">超大云端空间</h4>
                        <p className="text-xs text-gray-500 leading-relaxed">提供 500GB 极速云存，且不限速下载</p>
                      </div>
                      <div className="bg-[#111]/80 backdrop-blur rounded-lg p-5 border border-[#333]">
                        <Shield size={20} className="text-green-500 mb-3" />
                        <h4 className="font-semibold text-gray-200 mb-1">版权无忧保护</h4>
                        <p className="text-xs text-gray-500 leading-relaxed">商用版权全面授权及独立溯源数字水印</p>
                      </div>
                    </div>

                    <div className="mt-8 pt-8 border-t border-[#333] flex justify-between items-center relative z-10">
                      <button onClick={handleCancelSubscription} className="text-sm text-gray-400 hover:text-white underline underline-offset-4">取消订阅</button>
                      <Button onClick={handleManageSubscription} className="bg-yellow-500 hover:bg-yellow-400 text-black font-semibold border-0 shadow-[0_0_20px_rgba(234,179,8,0.2)]">
                        管理订阅协议
                      </Button>
                    </div>
                  </div>
                </Card>

                <Card className="p-8 bg-[#0A0A0A] border-[#222]">
                  <h3 className="text-lg font-semibold text-white mb-6">历史账单</h3>
                  <div className="space-y-4">
                     {Array.from({ length: settings.billing.invoicesLoaded }).map((_, index) => (
                       <div key={index} className="flex justify-between items-center py-3 border-b border-[#222] text-sm">
                         <div className="text-gray-300">{index === 0 ? '2023-11-20' : '2023-10-20'}</div>
                         <div className="text-gray-400">{settings.billing.planName}(包月)</div>
                         <div className="font-medium text-gray-200">￥{settings.billing.monthlyPrice}.00</div>
                         <div className="text-green-500">已支付</div>
                       </div>
                     ))}
                  </div>
                  <Button onClick={handleLoadMoreInvoices} variant="outline" className="w-full mt-6 border-[#333] text-gray-400 hover:text-gray-200">加载更多</Button>
                </Card>
              </div>
            )}

            {activeTab === 'workspace' && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
                <Card className="p-6 md:p-8 bg-[#0A0A0A] border-[#222]">
                  <h3 className="text-lg font-semibold text-white border-b border-[#222] pb-4 mb-6">工作区偏好设置</h3>

                  <div className="space-y-6">
                    <div className="flex items-center justify-between py-2">
                       <div>
                         <h4 className="font-medium text-gray-200">默认存储路径</h4>
                         <p className="text-xs text-gray-500 mt-1">设置本地文件导出的默认位置</p>
                       </div>
                       <Button onClick={handleChangeDirectory} variant="outline" size="sm" className="border-[#333] hover:border-blue-500">
                          更改目录
                       </Button>
                    </div>

                    <div className="flex items-center justify-between gap-6 py-2 border-t border-[#111]">
                       <div className="min-w-0">
                         <h4 className="font-medium text-gray-200">默认输出目录</h4>
                         <p className="text-xs text-gray-500 mt-1">媒体任务会写入该目录下的 tasks/任务ID/outputs</p>
                       </div>
                       <div className="flex items-center gap-3 min-w-0 w-full max-w-xl">
                         <input
                           type="text"
                           value={settings.workspace.outputDirectory}
                           onChange={(event) => setSettings({ ...settings, workspace: { ...settings.workspace, outputDirectory: event.target.value } })}
                           onBlur={handleSaveWorkspace}
                           className="min-w-0 flex-1 h-10 bg-[#111] border border-[#333] rounded-md px-3 text-sm focus:outline-none focus:border-blue-500 text-gray-200 transition-colors"
                         />
                         <Button onClick={handleChangeOutputDirectory} variant="outline" size="sm" className="border-[#333] hover:border-blue-500 shrink-0">
                            更改目录
                         </Button>
                       </div>
                    </div>

                    <div className="flex items-center justify-between py-2 border-t border-[#111]">
                       <div>
                         <h4 className="font-medium text-gray-200">硬件加速</h4>
                         <p className="text-xs text-gray-500 mt-1">利用本地显卡 (GPU) 加速素材解码和分析</p>
                       </div>
                       <div className="relative inline-flex items-center cursor-pointer">
                          <input type="checkbox" checked={settings.workspace.hardwareAcceleration} onChange={(event) => handleWorkspacePreferenceChange({ ...settings.workspace, hardwareAcceleration: event.target.checked })} className="sr-only peer" />
                          <div className="w-11 h-6 bg-[#222] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-gray-400 peer-checked:after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                       </div>
                    </div>

                    <div className="flex items-center justify-between py-2 border-t border-[#111]">
                       <div>
                         <h4 className="font-medium text-gray-200">完成时播放提示音</h4>
                         <p className="text-xs text-gray-500 mt-1">漫长任务处理完毕时播放短提示音</p>
                       </div>
                       <div className="relative inline-flex items-center cursor-pointer">
                          <input type="checkbox" checked={settings.workspace.completionSound} onChange={(event) => handleWorkspacePreferenceChange({ ...settings.workspace, completionSound: event.target.checked })} className="sr-only peer" />
                          <div className="w-11 h-6 bg-[#222] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-gray-400 peer-checked:after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                       </div>
                    </div>

                    <div className="flex items-center justify-between py-2 border-t border-[#111]">
                       <div>
                         <h4 className="font-medium text-gray-200">语言设置</h4>
                         <p className="text-xs text-gray-500 mt-1">应用界面的显示语言</p>
                       </div>
                       <select value={settings.workspace.language} onChange={(event) => handleWorkspacePreferenceChange({ ...settings.workspace, language: event.target.value })} onBlur={handleSaveWorkspace} className="bg-[#111] border border-[#333] rounded-md px-3 py-1.5 text-sm text-gray-200 outline-none focus:border-blue-500">
                         <option value="zh">简体中文</option>
                         <option value="en">English</option>
                       </select>
                    </div>
                  </div>
                </Card>
              </div>
            )}

            {activeTab === 'api' && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
                <Card className="p-6 md:p-8 bg-[#0A0A0A] border-[#222]">
                  <div className="flex justify-between items-center border-b border-[#222] pb-4 mb-6">
                    <h3 className="text-lg font-semibold text-white">API 密钥管理</h3>
                    <Button onClick={handleCreateApiKey} size="sm" className="bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-900/20">
                      创建新密钥
                    </Button>
                  </div>

                  <div className="bg-[#111] border border-[#222] rounded-lg p-5 mb-6 shadow-inner">
                     <p className="text-sm text-gray-400 leading-relaxed">
                       使用 API 密钥可将 SDKWork AutoCut 的推断能力通过 HTTP 请求接入您自己的应用或第三方服务中。请务必保护您的密钥，不要将其硬编码在客户端代码中。
                     </p>
                  </div>

                  <div className="space-y-4">
                    {settings.apiKeys.map((apiKey) => (
                      <div key={apiKey.id} className="group border border-[#222] rounded-lg p-4 hover:border-[#333] transition-colors bg-[#0A0A0A]">
                         <div className="flex justify-between items-start mb-4">
                           <div>
                             <h4 className="font-medium text-gray-200">{apiKey.name}</h4>
                             <p className="text-xs text-gray-500 mt-1">创建于 {apiKey.createdAt}{apiKey.revokedAt ? ` / 已撤销 ${apiKey.revokedAt}` : ''}</p>
                           </div>
                           <div className="flex gap-2">
                             <Button onClick={() => handleCopyApiKey(apiKey.maskedKey)} variant="outline" size="sm" className="h-8 border-[#333] text-gray-400 hover:text-white">复制</Button>
                             <Button onClick={() => handleRevokeApiKey(apiKey.id)} variant="outline" size="sm" className="h-8 border-[#333] text-red-500 hover:text-red-400 hover:border-red-500/50 hover:bg-red-500/10">撤销</Button>
                           </div>
                         </div>
                         <div className="font-mono text-sm bg-[#111] p-2.5 rounded border border-[#222] text-gray-400 flex items-center">
                           {apiKey.maskedKey}
                         </div>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            )}

            {activeTab === 'llm' && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
                <Card className="p-6 md:p-8 bg-[#0A0A0A] border-[#222]">
                  <div className="flex justify-between items-center border-b border-[#222] pb-4 mb-6">
                    <div>
                      <h3 className="text-lg font-semibold text-white">LLM 推理配置</h3>
                      <p className="text-xs text-gray-500 mt-1">使用 OpenAI 兼容接口接入不同模型供应商，默认采用 DeepSeek。</p>
                    </div>
                    <span className={`px-2.5 py-1 rounded text-[10px] border font-mono uppercase tracking-wider ${settings.llm.apiKeyConfigured ? 'bg-green-500/10 text-green-500 border-green-500/20' : 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20'}`}>
                      {settings.llm.apiKeyConfigured ? 'KEY READY' : 'KEY REQUIRED'}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-xs text-gray-500 uppercase tracking-wider font-semibold">ModelVendor</label>
                      <select
                        value={settings.llm.modelVendor}
                        onChange={(event) => handleLlmVendorChange(event.target.value as ModelVendor)}
                        className="w-full h-10 bg-[#111] border border-[#333] rounded-md px-3 text-sm text-gray-200 outline-none focus:border-blue-500 transition-colors"
                      >
                        {Object.values(AUTOCUT_MODEL_VENDOR_PRESETS).map((preset) => (
                          <option key={preset.vendor} value={preset.vendor}>{preset.label}</option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs text-gray-500 uppercase tracking-wider font-semibold">模型</label>
                      <input
                        type="text"
                        value={settings.llm.model}
                        list="llm-model-options"
                        onChange={(event) => handleLlmSettingsChange({ ...settings.llm, model: event.target.value })}
                        onBlur={handleSaveLlmSettings}
                        className="w-full h-10 bg-[#111] border border-[#333] rounded-md px-3 text-sm focus:outline-none focus:border-blue-500 text-gray-200 transition-colors"
                      />
                      <datalist id="llm-model-options">
                        {AUTOCUT_MODEL_VENDOR_PRESETS[settings.llm.modelVendor].models.map((model) => (
                          <option key={model.id} value={model.id}>{model.label}</option>
                        ))}
                      </datalist>
                      <p className="text-[11px] text-gray-600">
                        上下文 {formatAutoCutTokenCount(activeLlmModelPreset.contextWindowTokens)} tokens / 最大输出 {formatAutoCutTokenCount(activeLlmModelPreset.maxOutputTokens)} tokens
                      </p>
                    </div>

                    <div className="space-y-2 md:col-span-2">
                      <label className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Base URL</label>
                      <input
                        type="url"
                        value={settings.llm.baseUrl}
                        onChange={(event) => handleLlmSettingsChange({ ...settings.llm, baseUrl: event.target.value })}
                        onBlur={handleSaveLlmSettings}
                        className="w-full h-10 bg-[#111] border border-[#333] rounded-md px-3 text-sm focus:outline-none focus:border-blue-500 text-gray-200 transition-colors font-mono"
                      />
                    </div>

                    <div className="space-y-2 md:col-span-2">
                      <label className="text-xs text-gray-500 uppercase tracking-wider font-semibold">API Key</label>
                      <input
                        type="password"
                        value={settings.llm.apiKey ?? ''}
                        placeholder={settings.llm.maskedApiKey || '输入供应商 API Key'}
                        onChange={(event) => handleLlmSettingsChange({ ...settings.llm, apiKey: event.target.value })}
                        onBlur={handleSaveLlmSettings}
                        className="w-full h-10 bg-[#111] border border-[#333] rounded-md px-3 text-sm focus:outline-none focus:border-blue-500 text-gray-200 transition-colors font-mono"
                      />
                      <div className="font-mono text-xs bg-[#111] p-2.5 rounded border border-[#222] text-gray-500 flex items-center">
                        {settings.llm.maskedApiKey || '尚未保存 API Key'}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Temperature</label>
                      <input
                        type="number"
                        min={activeLlmModelPreset.temperature.min}
                        max={activeLlmModelPreset.temperature.max}
                        step={activeLlmModelPreset.temperature.step}
                        value={settings.llm.temperature}
                        onChange={(event) => handleLlmSettingsChange({ ...settings.llm, temperature: Number(event.target.value) })}
                        onBlur={handleSaveLlmSettings}
                        className="w-full h-10 bg-[#111] border border-[#333] rounded-md px-3 text-sm focus:outline-none focus:border-blue-500 text-gray-200 transition-colors"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Max Tokens</label>
                      <input
                        type="number"
                        min={activeLlmModelPreset.minOutputTokens}
                        max={activeLlmModelPreset.maxOutputTokens}
                        step={256}
                        value={settings.llm.maxTokens}
                        onChange={(event) => handleLlmSettingsChange({ ...settings.llm, maxTokens: Number(event.target.value) })}
                        onBlur={handleSaveLlmSettings}
                        className="w-full h-10 bg-[#111] border border-[#333] rounded-md px-3 text-sm focus:outline-none focus:border-blue-500 text-gray-200 transition-colors"
                      />
                      <p className="text-[11px] text-gray-600">
                        推荐 {formatAutoCutTokenCount(activeLlmModelPreset.defaultMaxTokens)}，上限 {formatAutoCutTokenCount(activeLlmModelPreset.maxOutputTokens)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-6 flex flex-wrap justify-end gap-3">
                    <Button
                      onClick={handleTestLlmConnection}
                      disabled={isTestingLlmConnection}
                      variant="outline"
                      className="text-white"
                    >
                      {isTestingLlmConnection ? '测试中...' : '测试连接'}
                    </Button>
                    <Button onClick={handleSaveLlmSettings} className="bg-blue-600 hover:bg-blue-500 text-white">保存 LLM 配置</Button>
                  </div>
                </Card>
              </div>
            )}

            {activeTab === 'speech' && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
                <Card className="p-6 md:p-8 bg-[#0A0A0A] border-[#222]">
                  <div className="flex justify-between items-center border-b border-[#222] pb-4 mb-6">
                    <div>
                      <h3 className="text-lg font-semibold text-white">Local Speech-to-Text</h3>
                      <p className="text-xs text-gray-500 mt-1">Configure a local Whisper-compatible toolchain for transcript-assisted slicing.</p>
                    </div>
                    <span className={`px-2.5 py-1 rounded text-[10px] border font-mono uppercase tracking-wider ${settings.speechTranscription.configured ? 'bg-green-500/10 text-green-500 border-green-500/20' : 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20'}`}>
                      {settings.speechTranscription.configured ? 'READY' : 'REQUIRED'}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2 md:col-span-2">
                      <label className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Executable Path</label>
                      <div className="flex gap-3">
                        <input
                          type="text"
                          value={settings.speechTranscription.executablePath}
                          onChange={(event) => handleSpeechTranscriptionSettingsChange({ ...settings.speechTranscription, executablePath: event.target.value })}
                          onBlur={handleSaveSpeechTranscriptionSettings}
                          className="min-w-0 flex-1 h-10 bg-[#111] border border-[#333] rounded-md px-3 text-sm focus:outline-none focus:border-blue-500 text-gray-200 transition-colors font-mono"
                        />
                        <Button onClick={() => handleSelectSpeechTranscriptionFile('executable')} variant="outline" className="border-[#333] text-white">Browse</Button>
                      </div>
                    </div>

                    <div className="space-y-2 md:col-span-2">
                      <label className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Model Path</label>
                      <div className="flex gap-3">
                        <input
                          type="text"
                          value={settings.speechTranscription.modelPath}
                          onChange={(event) => handleSpeechTranscriptionSettingsChange({ ...settings.speechTranscription, modelPath: event.target.value })}
                          onBlur={handleSaveSpeechTranscriptionSettings}
                          className="min-w-0 flex-1 h-10 bg-[#111] border border-[#333] rounded-md px-3 text-sm focus:outline-none focus:border-blue-500 text-gray-200 transition-colors font-mono"
                        />
                        <Button onClick={() => handleSelectSpeechTranscriptionFile('model')} variant="outline" className="border-[#333] text-white">Browse</Button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Language</label>
                      <select
                        value={settings.speechTranscription.language}
                        onChange={(event) => handleSpeechTranscriptionSettingsChange({ ...settings.speechTranscription, language: event.target.value })}
                        onBlur={handleSaveSpeechTranscriptionSettings}
                        className="w-full h-10 bg-[#111] border border-[#333] rounded-md px-3 text-sm text-gray-200 outline-none focus:border-blue-500 transition-colors"
                      >
                        <option value="auto">Auto</option>
                        <option value="zh">Chinese</option>
                        <option value="en">English</option>
                      </select>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Last Test</label>
                      <div className="h-10 bg-[#111] border border-[#333] rounded-md px-3 text-sm text-gray-500 flex items-center font-mono">
                        {settings.speechTranscription.lastTestedAt || 'Not tested'}
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 flex flex-wrap justify-end gap-3">
                    <Button
                      onClick={handleTestSpeechTranscriptionToolchain}
                      disabled={isTestingSpeechTranscription}
                      variant="outline"
                      className="text-white"
                    >
                      {isTestingSpeechTranscription ? 'Testing...' : 'Test Toolchain'}
                    </Button>
                    <Button onClick={handleSaveSpeechTranscriptionSettings} className="bg-blue-600 hover:bg-blue-500 text-white">Save Speech-to-Text</Button>
                  </div>
                </Card>
              </div>
            )}

            {activeTab === 'storage' && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
                <Card className="p-6 md:p-8 bg-[#0A0A0A] border-[#222]">
                  <h3 className="text-lg font-semibold text-white border-b border-[#222] pb-4 mb-6">存储空间管理</h3>

                  <div className="flex flex-col md:flex-row items-center gap-8 mb-8">
                     <div className="w-full md:w-1/3">
                        <div className="text-4xl font-extrabold text-blue-500">{settings.storage.usedGb} <span className="text-lg text-gray-500 font-medium tracking-wide">GB</span></div>
                        <p className="text-sm text-gray-400 mt-2">已使用存储空间</p>
                        <p className="text-xs text-gray-500 mt-1">配额 {settings.storage.quotaGb}GB (Pro 旗舰版)</p>
                     </div>
                     <div className="w-full md:w-2/3 space-y-4">
                        <div className="w-full h-3 bg-[#111] rounded-full overflow-hidden border border-[#222]">
                           <div className="h-full bg-blue-500 rounded-full min-w-[4px] shadow-[0_0_10px_rgba(59,130,246,0.6)]" style={{ width: `${Math.min(100, (settings.storage.usedGb / settings.storage.quotaGb) * 100)}%` }}></div>
                        </div>
                        <div className="flex justify-between text-xs text-gray-500 mt-2">
                           <span className="flex items-center gap-1.5"><div className="w-2 h-2 bg-blue-500 rounded-sm"></div> 视频媒体 ({settings.storage.videoGb}GB)</span>
                           <span className="flex items-center gap-1.5"><div className="w-2 h-2 bg-purple-500 rounded-sm"></div> 文档音频 ({settings.storage.documentGb}GB)</span>
                           <span className="flex items-center gap-1.5"><div className="w-2 h-2 bg-orange-500 rounded-sm"></div> 数据缓存 ({settings.storage.cacheGb}GB)</span>
                        </div>
                     </div>
                  </div>

                  <div className="bg-[#111] border border-[#222] rounded-xl p-5 flex flex-col sm:flex-row justify-between items-center gap-4">
                     <div className="text-sm text-gray-400">系统保存了多达 {settings.storage.cachedItems} 项历史任务及其产生的源资产。清理旧缓存可释放海量空间。</div>
                     <Button onClick={handleClearCache} className="bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/20 whitespace-nowrap">
                       一键清理极寒缓存
                     </Button>
                  </div>
                </Card>
              </div>
            )}

            {activeTab === 'notifications' && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
                <Card className="p-6 md:p-8 bg-[#0A0A0A] border-[#222]">
                  <h3 className="text-lg font-semibold text-white border-b border-[#222] pb-4 mb-6">通知设置</h3>

                  <div className="space-y-6">
                    <div>
                       <h4 className="font-semibold text-gray-200 mb-4">系统消息通知</h4>
                       <div className="space-y-3 pl-2 border-l-2 border-[#222] ml-1">
                          <label className="flex items-center gap-3 cursor-pointer">
                            <input type="checkbox" checked={settings.notifications.taskCompleted} onChange={(event) => handleNotificationPreferenceChange({ ...settings.notifications, taskCompleted: event.target.checked })} onBlur={handleSaveNotifications} className="w-4 h-4 rounded bg-[#111] border-[#333] text-blue-500 focus:ring-0" />
                            <span className="text-sm text-gray-300">长时间任务处理完毕通知</span>
                          </label>
                          <label className="flex items-center gap-3 cursor-pointer">
                            <input type="checkbox" checked={settings.notifications.appUpdates} onChange={(event) => handleNotificationPreferenceChange({ ...settings.notifications, appUpdates: event.target.checked })} onBlur={handleSaveNotifications} className="w-4 h-4 rounded bg-[#111] border-[#333] text-blue-500 focus:ring-0" />
                            <span className="text-sm text-gray-300">应用版本更新提示</span>
                          </label>
                          <label className="flex items-center gap-3 cursor-pointer">
                            <input type="checkbox" checked={settings.notifications.accountBilling} onChange={(event) => handleNotificationPreferenceChange({ ...settings.notifications, accountBilling: event.target.checked })} onBlur={handleSaveNotifications} className="w-4 h-4 rounded bg-[#111] border-[#333] text-blue-500 focus:ring-0" />
                            <span className="text-sm text-gray-300">账户状态与扣费通知</span>
                          </label>
                       </div>
                    </div>

                    <div className="pt-4 border-t border-[#111]">
                       <h4 className="font-semibold text-gray-200 mb-4">邮件营销与推送</h4>
                       <div className="space-y-3 pl-2 border-l-2 border-[#222] ml-1">
                          <label className="flex items-center gap-3 cursor-pointer">
                            <input type="checkbox" checked={settings.notifications.productAnnouncements} onChange={(event) => handleNotificationPreferenceChange({ ...settings.notifications, productAnnouncements: event.target.checked })} onBlur={handleSaveNotifications} className="w-4 h-4 rounded bg-[#111] border-[#333] text-blue-500 focus:ring-0" />
                            <span className="text-sm text-gray-300">接收 SDKWork 新产品发布邮件</span>
                          </label>
                          <label className="flex items-center gap-3 cursor-pointer">
                            <input type="checkbox" checked={settings.notifications.usageReports} onChange={(event) => handleNotificationPreferenceChange({ ...settings.notifications, usageReports: event.target.checked })} onBlur={handleSaveNotifications} className="w-4 h-4 rounded bg-[#111] border-[#333] text-blue-500 focus:ring-0" />
                            <span className="text-sm text-gray-300">发送使用简报与资产回顾</span>
                          </label>
                       </div>
                    </div>
                  </div>
                </Card>
              </div>
            )}

            {activeTab === 'security' && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
                <Card className="p-6 md:p-8 bg-[#0A0A0A] border-[#222]">
                  <h3 className="text-lg font-semibold text-white border-b border-[#222] pb-4 mb-6">安全与隐私管理</h3>

                  <div className="space-y-6">
                    <div className="flex items-center justify-between py-2">
                       <div>
                         <h4 className="font-medium text-gray-200">更新密码</h4>
                         <p className="text-xs text-gray-500 mt-1">定期更改密码以确保账户安全</p>
                       </div>
                        <Button onClick={handleChangePassword} variant="outline" size="sm" className="border-[#333]">
                          修改密码
                       </Button>
                    </div>

                    <div className="flex items-center justify-between py-2 border-t border-[#111]">
                       <div>
                         <h4 className="font-medium text-gray-200 flex items-center gap-2">两步验证 (2FA) <span className={`px-1.5 py-0.5 rounded text-[9px] border ${settings.security.twoFactorEnabled ? 'bg-green-500/10 text-green-500 border-green-500/20' : 'bg-red-500/10 text-red-500 border-red-500/20'}`}>{settings.security.twoFactorEnabled ? '已启用' : '未启用'}</span></h4>
                         <p className="text-xs text-gray-500 mt-1">增加一层额外的安全防护屏障</p>
                       </div>
                       <Button onClick={handleToggleTwoFactor} size="sm" className="bg-[#222] hover:bg-[#333] text-white">
                          开始设置
                       </Button>
                    </div>

                    <div className="flex items-center justify-between py-2 border-t border-[#111]">
                       <div>
                         <h4 className="font-medium text-gray-200">活动会话管理</h4>
                         <p className="text-xs text-gray-500 mt-1">注销在其他设备上已登录的账号</p>
                       </div>
                       <Button onClick={handleRevokeSessions} variant="outline" size="sm" className="border-[#333] text-red-500 hover:bg-red-500/10 hover:border-red-500/30">
                          退出全部设备
                       </Button>
                    </div>
                  </div>

                  <div className="mt-12 pt-6 border-t border-red-500/20">
                     <h4 className="font-bold text-red-500 mb-2">危险区域</h4>
                     <p className="text-xs text-gray-500 mb-4 leading-relaxed">一旦删除您的账户，与该账户关联的所有工作区、资产、任务记录和 API 请求日志都将被永久删除，此操作不可逆。</p>
                     <Button onClick={handleDeleteAccount} className="bg-red-600 hover:bg-red-500 text-white font-semibold">永久注销账户</Button>
                  </div>
                </Card>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
