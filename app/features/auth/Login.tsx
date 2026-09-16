"use client";

import { useState } from "react";
import { Logo, Pill } from "../../components/ui";
import type { StudioUser } from "../studio/types";

export function Login({ onEnter }: { onEnter: (user: StudioUser) => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const login = async () => {
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/me", { cache: "no-store" });
      if (!response.ok) throw new Error("当前账号未通过预览环境身份验证");
      const data = await response.json() as { user?: StudioUser };
      if (!data.user) throw new Error("未能读取账号信息");
      onEnter(data.user);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "登录失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <main className="login-page">
      <section className="login-showcase">
        <div className="login-brand"><Logo /></div>
        <div className="showcase-copy">
          <Pill dark>一人剧组 · 灵感马上成片</Pill>
          <h1>从一个故事，<br />到一部完整短剧。</h1>
          <p>剧本、角色、场景、分镜与成片，在同一个创作空间自然流动。</p>
        </div>
        <div className="showcase-film">
          {[["剧本", "01"], ["分镜", "02"], ["成片", "03"]].map(([label, number], index) => <div className={`film-frame film-${index + 1} truthful-film-frame`} key={label}><strong>{label}</strong><span>{number}</span></div>)}
        </div>
        <div className="showcase-footer"><span>SHORT DRAMA STUDIO</span><span>2026</span></div>
      </section>
      <section className="login-panel">
        <div className="login-card">
          <Logo />
          <div className="login-title">
            <h2>欢迎回来</h2>
            <p>使用当前平台账号继续你的小飞象创作</p>
          </div>
          <div className="account-login-summary"><span className="profile-avatar">飞</span><div><b>当前平台身份</b><p>项目和生成记录将保存到已验证账号</p></div><i>安全登录</i></div>
          {error && <p className="login-error" role="alert">{error}</p>}
          <button className="login-submit" onClick={() => void login()} disabled={submitting}>{submitting ? "正在验证账号…" : "使用当前账号进入"}</button>
          <p className="preview-auth-note">正式环境读取平台认证身份；本地开发环境使用隔离的本地创作者账号。</p>
        </div>
      </section>
    </main>
  );
}
