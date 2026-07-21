"use client";

import { useState } from "react";
import { Logo, Pill } from "../../components/ui";
import { videoImages } from "../studio/media";
import type { StudioUser } from "../studio/types";

export function Login({ onEnter }: { onEnter: (user: StudioUser) => void }) {
  const [phone, setPhone] = useState("138 6355 4010");
  const [code, setCode] = useState("8866");
  const [agreed, setAgreed] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const login = async () => {
    const normalizedPhone = phone.replace(/\D/g, "");
    if (normalizedPhone.length !== 11) return setError("请输入 11 位手机号");
    if (code.trim().length < 4) return setError("请输入验证码");
    if (!agreed) return setError("请先同意服务协议与隐私政策");
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/me", { cache: "no-store" });
      if (!response.ok) throw new Error("当前账号未通过预览环境身份验证");
      const data = await response.json() as { user?: StudioUser };
      if (!data.user) throw new Error("未能读取账号信息");
      window.sessionStorage.setItem("xiaofeixiang_entered", "1");
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
          {videoImages.map((image, index) => (
            <div className={`film-frame film-${index + 1}`} key={image} style={{ backgroundImage: `url(${image})` }}>
              <span>0{index + 1}</span>
            </div>
          ))}
        </div>
        <div className="showcase-footer"><span>SHORT DRAMA STUDIO</span><span>2026</span></div>
      </section>
      <section className="login-panel">
        <div className="login-card">
          <Logo />
          <div className="login-title">
            <h2>欢迎回来</h2>
            <p>登录后继续你的小飞象创作</p>
          </div>
          <label className="field-label">手机号</label>
          <div className="phone-field">
            <span>+86</span>
            <input value={phone} onChange={(event) => setPhone(event.target.value)} aria-label="手机号" />
          </div>
          <label className="field-label">验证码</label>
          <div className="code-field">
            <input value={code} onChange={(event) => setCode(event.target.value)} aria-label="验证码" />
            <button type="button" onClick={() => setCode("8866")}>获取验证码</button>
          </div>
          {error && <p className="login-error" role="alert">{error}</p>}
          <button className="login-submit" onClick={login} disabled={submitting}>{submitting ? "正在验证账号…" : "进入小飞象"}</button>
          <label className="agreement"><input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} /> 我已阅读并同意服务协议与隐私政策</label>
          <p className="preview-auth-note">当前预览使用平台账号完成身份验证，手机号短信服务接入后将直接绑定。</p>
          <div className="login-divider"><span>或</span></div>
          <button className="douyin-login"><span>♪</span> 使用抖音账号登录</button>
        </div>
      </section>
    </main>
  );
}
