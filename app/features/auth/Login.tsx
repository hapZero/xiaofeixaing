"use client";

import { useState } from "react";
import { Logo, Pill } from "../../components/ui";
import { videoImages } from "../studio/media";

export function Login({ onEnter }: { onEnter: () => void }) {
  const [phone, setPhone] = useState("138 6355 4010");
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
            <input defaultValue="8866" aria-label="验证码" />
            <button>获取验证码</button>
          </div>
          <button className="login-submit" onClick={onEnter}>进入小飞象</button>
          <label className="agreement"><input type="checkbox" defaultChecked /> 我已阅读并同意服务协议与隐私政策</label>
          <div className="login-divider"><span>或</span></div>
          <button className="douyin-login"><span>♪</span> 使用抖音账号登录</button>
        </div>
      </section>
    </main>
  );
}
