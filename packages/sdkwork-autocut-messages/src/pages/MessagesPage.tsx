import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Info, Check, Trash2, MailOpen, X, ExternalLink } from 'lucide-react';
import { Button } from '@sdkwork/autocut-commons';
import { AppMessage } from '@sdkwork/autocut-types';
import { getMessages, updateMessageRead, markAllMessagesRead, clearReadMessages, listenAutoCutEvent } from '@sdkwork/autocut-services';

export function MessagesPage() {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<AppMessage[]>([]);
  const [selectedMessage, setSelectedMessage] = useState<AppMessage | null>(null);
  const selectedActionUrl = selectedMessage?.actionUrl;

  const refreshMessages = async () => {
    const msgs = await getMessages();
    setMessages(msgs);
  };

  useEffect(() => {
    refreshMessages();
    const stopMessageAdded = listenAutoCutEvent('messageAdded', refreshMessages);
    const stopMessagesUpdated = listenAutoCutEvent('messagesUpdated', refreshMessages);
    return () => {
      stopMessageAdded();
      stopMessagesUpdated();
    };
  }, []);

  const [activeTab, setActiveTab] = useState('all');

  const unreadCount = messages.filter(m => !m.read).length;

  const filteredMessages = messages.filter(m => {
    if (activeTab === 'unread') return !m.read;
    return true; // for 'all'
  });

  const handleMarkAllAsRead = async () => {
    await markAllMessagesRead();
    refreshMessages();
  };

  const handleClearRead = async () => {
    await clearReadMessages();
    refreshMessages();
  };

  const handleMessageClick = async (msg: AppMessage) => {
    if (!msg.read) {
      await updateMessageRead(msg.id, true);
      refreshMessages();
      setSelectedMessage({ ...msg, read: true });
    } else {
      setSelectedMessage(msg);
    }
  };

  const handleActionClick = (url: string) => {
    setSelectedMessage(null);
    navigate(url);
  };

  return (
    <div className="w-full h-full p-6 md:p-10 flex flex-col items-center overflow-y-auto">
      <div className="w-full flex flex-col h-full space-y-8">

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-[#222] pb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-100 flex items-center gap-3">
              <span className="w-2 h-6 bg-blue-500 rounded-full"></span>
              消息通知中心
            </h1>
            <p className="text-sm text-gray-500 mt-2 ml-5">及时了解任务状态、系统通知与账户情况</p>
          </div>

          <div className="flex items-center gap-3">
             <Button variant="outline" className="flex items-center gap-2 text-xs" onClick={handleMarkAllAsRead}>
               <Check size={14} /> 全部标记为已读
             </Button>
             <Button variant="outline" className="flex items-center gap-2 text-xs border-red-500/20 text-red-500 hover:bg-red-500/10" onClick={handleClearRead}>
               <Trash2 size={14} /> 清空已读
             </Button>
          </div>
        </div>

        <div className="flex items-center gap-6 border-b border-[#222]">
           <button
             onClick={() => setActiveTab('all')}
             className={`pb-4 text-sm font-semibold transition-colors border-b-2 ${activeTab === 'all' ? 'border-blue-500 text-blue-500' : 'border-transparent text-gray-400 hover:text-gray-200'}`}
           >
             全部消息
           </button>
           <button
             onClick={() => setActiveTab('unread')}
             className={`pb-4 text-sm font-semibold transition-colors border-b-2 flex items-center gap-2 ${activeTab === 'unread' ? 'border-blue-500 text-blue-500' : 'border-transparent text-gray-400 hover:text-gray-200'}`}
           >
             未读消息
             {unreadCount > 0 && (
               <span className={`px-2 py-0.5 rounded-full text-[10px] ${activeTab === 'unread' ? 'bg-blue-500 text-white' : 'bg-red-500 text-white'}`}>
                 {unreadCount}
               </span>
             )}
           </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-3">
           {filteredMessages.length === 0 ? (
             <div className="flex flex-col items-center justify-center p-20 text-gray-500 bg-[#0A0A0A] border border-[#222] border-dashed rounded-xl">
               <MailOpen size={48} className="mb-4 opacity-30" />
               <p className="text-sm">没有新的消息</p>
             </div>
           ) : (
             filteredMessages.map(msg => (
               <div
                 key={msg.id}
                 onClick={() => handleMessageClick(msg)}
                 className={`flex items-start gap-4 p-5 rounded-xl border transition-all cursor-pointer hover:-translate-y-0.5 ${msg.read ? 'bg-[#0A0A0A] border-[#222] opacity-70' : 'bg-[#141414] border-[#333] shadow-md hover:border-[#444]'}`}
               >

                 <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 border ${
                   msg.type === 'success' ? 'bg-green-500/10 border-green-500/20 text-green-500' :
                   msg.type === 'warning' ? 'bg-orange-500/10 border-orange-500/20 text-orange-500' :
                   msg.type === 'error' ? 'bg-red-500/10 border-red-500/20 text-red-500' :
                   'bg-blue-500/10 border-blue-500/20 text-blue-500'
                 }`}>
                    {msg.type === 'success' && <CheckCircle2 size={20} />}
                    {msg.type === 'warning' && <AlertTriangle size={20} />}
                    {msg.type === 'error' && <AlertTriangle size={20} />}
                    {msg.type === 'info' && <Info size={20} />}
                 </div>

                 <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start mb-1">
                      <h3 className={`text-sm font-semibold flex items-center gap-2 ${msg.read ? 'text-gray-300' : 'text-gray-100'}`}>
                        {msg.title}
                        {!msg.read && <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0"></span>}
                      </h3>
                      <span className="text-xs text-gray-500 whitespace-nowrap ml-4">{msg.createdAt}</span>
                    </div>
                    <p className={`text-xs leading-relaxed line-clamp-2 ${msg.read ? 'text-gray-500' : 'text-gray-400'}`}>
                      {msg.description}
                    </p>
                 </div>

               </div>
             ))
           )}
        </div>
      </div>

      {/* Message Detail Modal */}
      {selectedMessage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setSelectedMessage(null)}>
          <div
            className="w-full max-w-lg bg-[#141414] border border-[#222] rounded-2xl shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-5 border-b border-[#222]">
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center border ${
                   selectedMessage.type === 'success' ? 'bg-green-500/10 border-green-500/20 text-green-500' :
                   selectedMessage.type === 'warning' ? 'bg-orange-500/10 border-orange-500/20 text-orange-500' :
                   selectedMessage.type === 'error' ? 'bg-red-500/10 border-red-500/20 text-red-500' :
                   'bg-blue-500/10 border-blue-500/20 text-blue-500'
                 }`}>
                    {selectedMessage.type === 'success' && <CheckCircle2 size={16} />}
                    {selectedMessage.type === 'warning' && <AlertTriangle size={16} />}
                    {selectedMessage.type === 'error' && <AlertTriangle size={16} />}
                    {selectedMessage.type === 'info' && <Info size={16} />}
                 </div>
                <h3 className="font-bold text-gray-100">{selectedMessage.title}</h3>
              </div>
              <button
                className="p-1 text-gray-500 hover:text-white hover:bg-[#222] rounded transition-colors"
                onClick={() => setSelectedMessage(null)}
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6">
              <span className="text-xs text-blue-500 font-mono mb-4 block">{selectedMessage.createdAt}</span>
              <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">
                {selectedMessage.description}
              </p>
            </div>

            <div className="p-4 border-t border-[#222] bg-[#0A0A0A] rounded-b-2xl flex justify-end gap-3">
              {selectedActionUrl && (
                <Button variant="primary" className="flex items-center gap-2" onClick={() => handleActionClick(selectedActionUrl)}>
                  <ExternalLink size={16} />
                  {selectedMessage.actionLabel || '进入'}
                </Button>
              )}
              <Button variant="outline" onClick={() => setSelectedMessage(null)}>
                关闭
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
