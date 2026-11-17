import React, { useState } from 'react';
import {
  MessageSquare,
  Layers,
  Megaphone,
  Zap,
  Menu,
  X,
  Search,
  ScanSearch,
  Cpu,
  Phone,
  UserCheck,
  Users,
  Key,
  CreditCard,
  DownloadCloud,
  Sun,
  Moon,
  LogOut,
  ShieldAlert
} from 'lucide-react';

export default function MobileBottomNav({
  activeView,
  activeModal,
  onSelectView,
  onOpenModal,
  theme,
  onToggleTheme,
  hasCheckpoint = false,
  sessionUser,
  onLogout,
  updateStatus,
  unreadCount = 0
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const isCompanyAdmin = sessionUser?.company_role !== 'EMPLOYEE';

  const handleAction = (item) => {
    setMenuOpen(false);
    if (item.isModal) {
      onOpenModal?.(item.id);
    } else {
      onOpenModal?.(null);
      onSelectView?.(item.id);
    }
  };

  const primaryTabs = [
    { id: 'chat', label: 'Hội thoại', icon: MessageSquare, badge: unreadCount > 0 ? unreadCount : null },
    { id: 'pageManager', label: 'Fanpage', icon: Layers, isModal: true },
    { id: 'campaigns', label: 'Chiến dịch', icon: Megaphone, isModal: true },
    { id: 'autoReply', label: 'Tự động', icon: Zap, isModal: true }
  ];

  const allFeatures = [
    { id: 'chat', label: 'Hội thoại & Tin nhắn', desc: 'Trực chat Fanpage & cá nhân', icon: MessageSquare, color: 'text-sky-400 bg-sky-500/15' },
    { id: 'pageManager', label: 'Fanpage & Token API', desc: 'Nhập Token Page, Webhook, Đồng bộ', icon: Layers, isModal: true, color: 'text-violet-400 bg-violet-500/15' },
    { id: 'accounts', label: 'Quản lý Tài khoản & Nguồn', desc: 'Fanpage, tài khoản FB & VietSeeding', icon: hasCheckpoint ? ShieldAlert : UserCheck, isModal: true, color: hasCheckpoint ? 'text-red-400 bg-red-500/15' : 'text-emerald-400 bg-emerald-500/15' },
    { id: 'search', label: 'Tìm kiếm tin nhắn', desc: 'Tra cứu khách hàng & lịch sử chat', icon: Search, isModal: true, color: 'text-blue-400 bg-blue-500/15' },
    { id: 'commentLeads', label: 'Khách bình luận bài viết', desc: 'Quét bình luận Fanpage & nhắn tin', icon: ScanSearch, isModal: true, color: 'text-cyan-400 bg-cyan-500/15' },
    { id: 'campaigns', label: 'Chiến dịch gửi tin', desc: 'Remarketing & gửi tin hàng loạt', icon: Megaphone, isModal: true, color: 'text-amber-400 bg-amber-500/15' },
    { id: 'autoReply', label: 'Trả lời tự động', desc: 'Kịch bản tự động & mẫu câu nhanh', icon: Zap, isModal: true, color: 'text-yellow-400 bg-yellow-500/15' },
    { id: 'aiConfig', label: 'Cài đặt AI trả lời', desc: 'Cấu hình trợ lý AI thông minh', icon: Cpu, isModal: true, color: 'text-purple-400 bg-purple-500/15' },
    { id: 'phoneAutomation', label: 'Tự động Số điện thoại', desc: 'Bắt SĐT khách & tự động gắn thẻ', icon: Phone, isModal: true, color: 'text-teal-400 bg-teal-500/15' },
    ...(isCompanyAdmin ? [
      { id: 'employees', label: 'Quản lý Nhân viên', desc: 'Phân quyền nhân sự trực Page', icon: Users, color: 'text-indigo-400 bg-indigo-500/15' },
      { id: 'license', label: 'Bản quyền Key', desc: 'Kiểm tra & kích hoạt mã bản quyền', icon: Key, isModal: true, color: 'text-orange-400 bg-orange-500/15' },
      { id: 'payment', label: 'Mua / Gia hạn License', desc: 'Thanh toán nhanh qua VietQR MB', icon: CreditCard, isModal: true, color: 'text-pink-400 bg-pink-500/15' }
    ] : []),
    { id: 'appUpdate', label: updateStatus?.updateAvailable ? `Cập nhật mới v${updateStatus.latestVersion}` : 'Cập nhật ứng dụng', desc: `Phiên bản hiện tại: v${updateStatus?.currentVersion || '1.0.40'}`, icon: DownloadCloud, isModal: true, color: 'text-sky-400 bg-sky-500/15' }
  ];

  return (
    <>
      <nav
        className="mobile-bottom-nav"
        aria-label="Điều hướng di động"
      >
        {primaryTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = tab.isModal
            ? activeModal === tab.id
            : (!activeModal && activeView === tab.id);
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleAction(tab)}
              className={`mobile-bottom-nav-btn ${isActive ? 'active' : ''}`}
            >
              <span className="relative inline-flex items-center justify-center">
                <Icon size={20} strokeWidth={isActive ? 2.2 : 1.8} />
                {tab.badge && (
                  <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-4 px-1 rounded-full bg-[var(--color-danger)] text-white text-[10px] font-bold flex items-center justify-center">
                    {tab.badge > 99 ? '99+' : tab.badge}
                  </span>
                )}
              </span>
              <span className="text-[11px] font-semibold mt-0.5 truncate">{tab.label}</span>
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          className={`mobile-bottom-nav-btn ${menuOpen ? 'active' : ''}`}
        >
          <span className="relative inline-flex items-center justify-center">
            <Menu size={20} strokeWidth={1.9} />
            {(hasCheckpoint || updateStatus?.updateAvailable) && (
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-[var(--color-danger)]" />
            )}
          </span>
          <span className="text-[11px] font-semibold mt-0.5 truncate">Menu</span>
        </button>
      </nav>

      {menuOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex flex-col justify-end"
          onClick={() => setMenuOpen(false)}
        >
          <div
            className="w-full max-h-[86dvh] bg-[var(--color-bg-panel)] border-t border-[var(--color-border)] rounded-t-2xl shadow-2xl flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-4 py-3.5 border-b border-[var(--color-border)] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-[var(--color-accent)] text-white font-extrabold text-xs flex items-center justify-center shrink-0">
                  EC
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-bold text-[var(--color-text-primary)] truncate">
                    EasyChat Mobile · {sessionUser?.username || 'Admin'}
                  </div>
                  <div className="text-[11px] text-[var(--color-text-muted)] truncate">
                    Messenger Fanpage CRM · v{updateStatus?.currentVersion || '1.0.40'}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="w-8 h-8 rounded-full bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] flex items-center justify-center"
                aria-label="Đóng menu"
              >
                <X size={18} />
              </button>
            </div>

            {/* Grid of all CRM features */}
            <div className="p-3.5 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-2">
              {allFeatures.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleAction(item)}
                    className="flex items-center gap-3 p-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)]/70 hover:bg-[var(--color-bg-hover)] text-left transition-colors"
                  >
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${item.color}`}>
                      <Icon size={20} strokeWidth={1.9} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-[var(--color-text-primary)] truncate">
                        {item.label}
                      </div>
                      <div className="text-[11px] text-[var(--color-text-muted)] truncate mt-0.5">
                        {item.desc}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Bottom Actions: Theme + Logout */}
            <div className="p-3.5 border-t border-[var(--color-border)] bg-[var(--color-bg-surface)]/40 flex items-center justify-between gap-2 shrink-0">
              <button
                type="button"
                onClick={() => { onToggleTheme?.(); }}
                className="flex-1 h-10 px-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-panel)] text-xs font-semibold text-[var(--color-text-primary)] flex items-center justify-center gap-2"
              >
                {theme === 'dark' ? (
                  <>
                    <Sun size={16} className="text-amber-400" />
                    <span>Giao diện Sáng</span>
                  </>
                ) : (
                  <>
                    <Moon size={16} className="text-sky-500" />
                    <span>Giao diện Tối</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => { setMenuOpen(false); onLogout?.(); }}
                className="flex-1 h-10 px-3 rounded-xl border border-red-500/30 bg-red-500/10 text-xs font-semibold text-red-400 flex items-center justify-center gap-2"
              >
                <LogOut size={16} />
                <span>Đăng xuất</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
