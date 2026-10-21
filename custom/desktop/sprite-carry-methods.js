  // ---- 桌面图标搬运（dsh-pet-custom:carry）：走到图标 → 抱起 → 与图标同步走到目标 ----
  /** 走到视口坐标 (cx,cy)（宠物中心），窗口逐帧跟随；animName 循环播放，durationMs 缺省按 170px/s 估 */
  carryWalkTo(cx, cy, animName, durationMs) {
    return new Promise((resolve) => {
      this.stopMove();
      this.stopThrow();
      this.stopDragFollow();
      const token = ++this.carryToken;
      const sx = this.currentCenterX();
      const sy = this.currentCenterY();
      const dx = cx - sx;
      const dy = cy - sy;
      const dist = Math.hypot(dx, dy);
      if (dist < 1) return resolve();
      if (dx < -8) this.facing = 'left';
      else if (dx > 8) this.facing = 'right';
      if (animName) this.switchTo(animName, false);
      const front = this.front === 0 ? this.videoA : this.videoB;
      if (front) front.style.transform = this.facing === 'right' ? 'scaleX(-1)' : '';
      const dur = durationMs || Math.max(450, Math.min(4500, (dist / 170) * 1000));
      const t0 = performance.now();
      const step = () => {
        if (this.carryToken !== token) return resolve();
        const p = Math.min(1, (performance.now() - t0) / dur);
        this.sendBounds(sx + dx * p - this.halfW, sy + dy * p - this.halfH);
        if (p < 1) this.carryRef = requestAnimationFrame(step);
        else {
          this.carryRef = null;
          resolve();
        }
      };
      this.carryRef = requestAnimationFrame(step);
    });
  }

  /** 宿主 /desktop/carry 下发：{ id, name, from:{x,y}, to:{x,y} }（屏幕 CSS px） */
  async startCarry(p) {
    if (!p || this.carrying || !p.from || !p.to) return;
    this.carrying = true;
    try {
      // Finder 坐标（屏幕）→ 视口坐标；图标约 64px，把宠物中心对到图标中心
      const iconCx = p.from.x - VIEW.x + 32;
      const iconCy = p.from.y - VIEW.y + 32;
      const destCx = p.to.x - VIEW.x + 32;
      const destCy = p.to.y - VIEW.y + 32;
      const acts = (this.animations.moves && this.animations.moves.actions) || [];
      const walk = (acts[0] && acts[0].name) || this.animations.idle[0] || this.anim;
      const lift = (this.animations.clicks && this.animations.clicks[0]) || this.animations.idle[0] || this.anim;
      await this.carryWalkTo(iconCx, iconCy, walk);
      this.switchTo(lift, true); // 抱起
      await new Promise((r) => window.setTimeout(r, 420));
      const dist = Math.hypot(destCx - iconCx, destCy - iconCy);
      const dur = Math.max(900, Math.min(6000, (dist / 150) * 1000));
      try {
        await fetch(BASE + '/desktop/carry/grab', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: p.id, duration: dur / 1000, x: Math.round(this.currentCenterX() + VIEW.x), y: Math.round(this.currentCenterY() + VIEW.y) }),
        });
      } catch (e) {
        console.warn('[dsh-pet] carry grab 请求失败：' + (e && e.message ? e.message : String(e)));
      }
      await this.carryWalkTo(destCx, destCy, walk, dur);
      this.switchTo(lift, true); // 放下
    } catch (e) {
      console.warn('[dsh-pet] 搬图标失败：' + (e && e.message ? e.message : String(e)));
    } finally {
      this.carrying = false;
    }
  }
