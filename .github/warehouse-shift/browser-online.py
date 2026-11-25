"""Play a shift across two Chromium contexts using the local game and Wrangler."""
import json
import os
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import TimeoutError, sync_playwright

ORIGIN = "http://127.0.0.1:8000"
GAME = ORIGIN + "/tools/warehouse-shift.html"
RELAY = "http://127.0.0.1:" + os.environ.get("RELAY_PORT", "8787")
LOGIN = """localStorage.setItem('toolbox.signedIn.area20','STEPHEN');
localStorage.setItem('ws-sound','off');"""
PADS = """window.testPads = [0,1].map(index => ({index, connected:true, mapping:'standard',
  axes:[0,0,0,0], buttons:Array.from({length:17}, () => ({pressed:false,value:0}))}));
Object.defineProperty(navigator,'getGamepads',{value:() => testPads});"""


def open_game(browser, errors, *, phone=False, online=True, saved_career=None):
    context = browser.new_context(viewport={"width": 880 if phone else 1000, "height": 470},
                                  has_touch=phone, is_mobile=phone, device_scale_factor=1, service_workers="block")
    context.route("**/*", lambda route: route.continue_() if urlsplit(route.request.url).hostname == "127.0.0.1" else route.abort())
    context.add_init_script(LOGIN)
    if saved_career:
        context.add_init_script("""(() => {
          if (sessionStorage.getItem('playtest-fixture')) return;
          for (const [key, value] of Object.entries(%s)) localStorage.setItem(key, value);
          sessionStorage.setItem('playtest-fixture', '1');
        })();""" % json.dumps(saved_career))
    if not online:
        context.add_init_script(PADS)
    page = context.new_page()
    page.on("pageerror", lambda error: errors.append(error.stack or str(error)))
    page.goto(GAME + ("?relay=" + RELAY if online else ""), wait_until="domcontentloaded")
    page.wait_for_function("!!window.__shift || !!document.getElementById('msgText').textContent", timeout=100_000)
    assert page.evaluate("!!window.__shift"), page.locator("#msgText").text_content()
    page.evaluate("ShiftDay.rollEvent = () => null")
    return page


def shared_shift(browser, errors):
    host = open_game(browser, errors)
    host.locator("#nameIn").fill("Morgan")
    host.locator("#onlineBtn").click()
    host.locator("#hostRoom").click()
    try:
        host.locator("#roomBtn").wait_for()
    except TimeoutError as error:
        raise AssertionError(f"Host room failed: {host.locator('#roomMessage').text_content()}; page errors: {errors}") from error
    code = host.locator("#roomBtn").text_content()[:6]
    host.evaluate("for (const job of __shift.prio()) job.on = false")
    guest = open_game(browser, errors, phone=True)
    guest.locator("#onlineBtn").tap()
    guest.locator("#roomCode").fill(code)
    guest.locator("#joinRoom").tap()
    guest.wait_for_function("!roomBtn.hidden && roomBtn.textContent.includes('2/4')", timeout=60_000)
    assert guest.evaluate("__shift.crew.length") == 0
    assert host.evaluate("__shift.crew.length") == 1

    # Find a real delivery, mirror its original empty shelf, then put it into its labelled destination.
    carton = host.evaluate("""() => {
      const day = __shift.day(), src = day.deliveryLeft()[0].src, c = day.paTake(src,'p1');
      return {id:c.id, sku:c.item.code, dest:c.loc.code};
    }""")
    guest.wait_for_function("""d => {
      const c = __shift.day().delivery.find(v => v.id === d.id);
      return c.by === 'p1' && c.loc.code === d.dest && c.item.loc === null;
    }""", arg=carton)
    host.evaluate("""() => {
      __shift.day().faultSchedule = [0.15]; __shift.tick(0.2);
    }""")
    rain = host.locator(".sc-code-rain")
    rain.wait_for(state="visible")
    colours = rain.locator("span").first.evaluate("""el => [
      getComputedStyle(el).color, getComputedStyle(el.closest('.sc-offline')).backgroundColor,
      getComputedStyle(el).animationName
    ]""")
    assert colours == ["rgb(255, 255, 255)", "rgb(0, 0, 0)", "sc-code-fall"]
    offline = host.locator(".sc-offline")
    offline.get_by_text("Server connection issue", exact=True).wait_for()
    offline.get_by_text("Swap at the charging dock in the office.", exact=True).wait_for()
    assert not guest.locator(".sc-offline").is_visible()
    original_pose = host.evaluate("({x:__shift.me.x,y:__shift.me.y,yaw:__shift.me.yaw,pitch:__shift.me.pitch})")
    host.evaluate("""() => {
      const s=__shift, q=s.world.scannerDock;
      Object.assign(s.me,{x:q.x,y:q.y-0.85,yaw:Math.PI,pitch:Math.atan2(q.z-s.me.eye,0.85)});
      s.applyCam();
    }""")
    host.get_by_role("button", name="Swap scanner").click()
    offline.wait_for(state="hidden")
    host.evaluate("pose => {Object.assign(__shift.me,pose); __shift.applyCam();}", original_pose)
    host.evaluate("id => {const d=__shift.day(); d.paPut(d.delivery.find(c=>c.id===id),'p1');}", carton["id"])
    guest.wait_for_function("""d => {
      const item=__shift.world.locs.byCode[d.dest].item;
      return item?.code === d.sku && item.mesh && !item.hidden;
    }""", arg=carton)

    guest.evaluate("""() => {
      const s=__shift, stool=s.world.stools[0], side=stool.x<(s.world.centre.x0+s.world.centre.x1)/2 ? 1 : -1;
      s.me.x=stool.x+side*0.9; s.me.y=stool.y; s.me.yaw=side*Math.PI/2;
      s.me.pitch=Math.atan2(0.25-s.me.eye,0.9); s.applyCam();
    }""")
    guest.get_by_role("button", name="Take stool", exact=False).tap()
    host.wait_for_function("__shift.world.stools[0].by === 'p2'")
    guest.locator("#stepBtn").tap()
    assert guest.evaluate("!!__shift.me.step")
    guest.locator("#stepBtn").tap()

    host.evaluate("""() => {const s=__shift; s.me.y=s.world.start.y-3.1; s.me.yaw=Math.PI; s.applyCam();}""")
    guest.evaluate("""() => {const s=__shift; s.me.x=s.world.start.x; s.me.y=s.world.start.y;
      s.me.yaw=0; s.me.pitch=-0.07; s.applyCam();}""")
    device = guest.context.new_cdp_session(guest)
    for w, h in [(420, 800), (880, 470)]:
        portrait = w < h
        device.send("Emulation.setDeviceMetricsOverride", {
            "width": w, "height": h, "screenWidth": w, "screenHeight": h, "deviceScaleFactor": 1, "mobile": True,
            "screenOrientation": {"type": "portraitPrimary" if portrait else "landscapePrimary", "angle": 0 if portrait else 90},
        })
        guest.wait_for_function("""w => {
          const s=__shift, room=roomBtn.getBoundingClientRect(), stats=chips.getBoundingClientRect();
          return s.players[0].view.w === w && room.bottom <= stats.top && room.width > 0 &&
            !document.querySelector('#stickZone').hidden && s.players[0].view.landscape === (w > 500);
        }""", arg=w)
        if portrait:
            scanner = guest.locator("#scanner").bounding_box()
            assert scanner["x"] > w / 2 and scanner["y"] < h / 8
            assert scanner["height"] <= h * 0.4
            small = guest.locator("#scFn")
            original_height = small.bounding_box()["height"]
            small.tap()
            enlarged = guest.locator('[data-el="scConfirmFn"]')
            assert enlarged.bounding_box()["height"] > original_height
            enlarged.tap()
            assert enlarged.is_hidden()
            guest.evaluate("""() => {
              const s=__shift, q=s.world.pc;
              Object.assign(s.me,{x:q.x,y:q.y-0.9,yaw:Math.PI,pitch:Math.atan2(1.05-s.me.eye,0.9)});
              s.applyCam();
            }""")
            guest.get_by_role("button", name="Use PC").tap()
            shop = guest.locator(".ws-shop")
            assert shop.is_visible()
            assert shop.get_by_text("Scanner name label").is_visible()
            bounds = shop.bounding_box()
            assert bounds["x"] >= 0 and bounds["x"] + bounds["width"] <= w
            shop.get_by_text("Kickstool shoes").scroll_into_view_if_needed()
            assert shop.get_by_text("Kickstool shoes").is_visible()
            guest.locator(".ws-pc-x").tap()
            guest.evaluate("""() => {const s=__shift;
              Object.assign(s.me,{x:s.world.start.x,y:s.world.start.y,yaw:0,pitch:-0.07}); s.applyCam();
            }""")
    # Wait for the other browser's worker figure to reach the host's new spot.
    host_xy = host.evaluate("[__shift.me.x,__shift.me.y]")
    guest.wait_for_function("""([x,y]) => __shift.S.scene.children.some(o => o.visible &&
      o.isGroup && Math.hypot(o.position.x-x,o.position.z-y) < 0.12)""", arg=host_xy)
    screenshot = os.environ.get("WAREHOUSE_SCREENSHOT")
    if screenshot:
        guest.screenshot(path=Path(screenshot))
    host.context.close()
    guest.context.close()


def desktop_mouse_capture(browser, errors):
    page = open_game(browser, errors, online=False)
    page.locator("#startBtn").click()
    page.wait_for_function("document.pointerLockElement === view")
    page.evaluate("window.currentShift = __shift.day()")
    for _ in range(4):
        page.keyboard.press("Escape")
        page.locator("#startCover").wait_for(state="visible")
        page.locator("#startBtn").click()
        page.wait_for_function("document.pointerLockElement === view")
        assert page.locator("#startCover").is_hidden()
        assert page.evaluate("__shift.day() === currentShift")
    page.context.close()


def split_shift(browser, errors):
    page = open_game(browser, errors, online=False)
    assert page.locator("#onlineBtn").is_visible()
    page.locator("#twoBtn").click()
    page.evaluate("""() => {
      for (const gp of testPads) {
        gp.buttons[0]={pressed:true,value:1}; __shift.pollPads(0.02);
        gp.buttons[0]={pressed:false,value:0}; __shift.pollPads(0.02);
      }
    }""")
    page.locator("#joinGo").click()
    assert page.evaluate("""() => {
      const [a,b]=__shift.players;
      return __shift.split() && a.padIndex===0 && b.padIndex===1 && a.view.x===0 &&
        a.view.x+a.view.w===b.view.x && a.view.y===b.view.y;
    }""")
    page.evaluate("window.currentShift = __shift.day()")
    page.keyboard.press("Escape")
    assert page.locator("#startCover").is_visible()
    assert page.get_by_role("button", name="Play tutorial").is_visible()
    page.get_by_role("button", name="Continue", exact=True).click()
    assert page.evaluate("__shift.split() && __shift.day() === currentShift")
    page.keyboard.press("Escape")
    page.once("dialog", lambda dialog: dialog.accept())
    page.locator("#tutorialBtn").click()
    page.locator("#lessonCover").wait_for()
    assert page.evaluate("!__shift.split() && !__shift.day()")
    page.context.close()


def recorded_solo_shift(browser, errors):
    saved_career = {
        "ws-shift-xp/regular": "442", "ws-scanner-reliability": "2", "ws-digital-first": "2", "ws-player-speed": "2",
        "ws-kit-label": "1", "ws-sam": "off", "ws-sam-job-slots": "2",
        "ws-sam-preset-0": "[]",
        "ws-sam-training": json.dumps({"delivery": "included", "cust": "paid"}),
        "ws-sam-prio": json.dumps([{"id": job, "on": job == "cust"}
                                  for job in ["cust", "queue", "hold", "delivery"]]),
        "ws-stats-v1": json.dumps({"orders": 12, "lines": 24, "units": 48})
    }
    page = open_game(browser, errors, phone=True, online=False, saved_career=saved_career)
    assert "442 career XP" in page.locator("#careerXP").inner_text()
    assert page.locator("#startBtn").inner_text() == "Continue"
    assert not page.locator("#recordPlaytest").is_checked()
    page.locator("#recordPlaytest").tap()
    assert "Day 1 · 0 XP" in page.locator("#careerXP").inner_text()
    page.locator("#startBtn").tap()
    page.locator("#menuBtn").tap()
    page.wait_for_timeout(200)
    page.locator("#startBtn").tap()
    page.evaluate("""() => {
      const s = __shift, day = s.day(), carton = day.paTake(undefined, 'p1');
      day.faultSchedule = [0.1]; s.tick(0.2);
      const q = s.world.scannerDock;
      Object.assign(s.me, {x:q.x, y:q.y - 0.85, yaw:Math.PI, pitch:Math.atan2(q.z - s.me.eye, 0.85)});
      s.applyCam();
      window.playtestCarton = carton.id;
    }""")
    page.get_by_role("button", name="Swap scanner", exact=True).tap()
    page.evaluate("""() => {
      const s = __shift, day = s.day();
      day.paPut(day.delivery.find(c => c.id === window.playtestCarton), 'p1');
      const carton = day.paTake(undefined, 'Sam'); day.paPut(carton, 'Sam');
      const pick = day.makeOrder('ck', [], null, true);
      day.take(pick, 'p1'); day.picked(pick); day.handOver(pick, 'p1');
      for (let i = 0; i < 10; i++) day.credit('p1', 'line-playtest-' + i, 10);
      s.players[0].openPc();
    }""")
    page.locator('[data-pc="shop"]').tap()
    page.locator('[data-sam-speed]').tap()
    assert "Tier 3" in page.locator('[data-sam-speed]').inner_text()
    page.locator(".ws-pc-x").tap()
    page.evaluate("""() => {
      const s = __shift;
      s.day().phase = 'lock';
      const door = s.world.openings.find(o => o.type === 'entrance');
      Object.assign(s.me, {x:(door.from + door.to) / 2, y:s.world.D - 1.5, yaw:Math.PI, pitch:0});
      s.applyCam();
    }""")
    page.get_by_role("button", name="Lock door", exact=False).tap()
    page.evaluate("""Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: text => { window.copiedPlaytest = text; return Promise.resolve(); }
    }})""")
    page.locator("#copyPlaytest").tap()
    page.get_by_text("Copied. Paste the summary into your chat.").wait_for()
    summary = json.loads(page.evaluate("window.copiedPlaytest"))
    assert summary["start"]["day"] == 1 and summary["start"]["touchControls"]
    assert summary["start"]["progression"] == {
        "xpAvailable": 0, "xpCareer": 0, "scannerTier": 1, "digitalTier": 1, "playerSpeedTier": 1, "equipment": [],
        "sam": {"enabled": True, "speedTier": 1, "skills": ["queue", "cust", "hold", "delivery"],
                "jobs": ["queue", "cust", "hold", "delivery"]}
    }
    assert summary["timing"]["menuBreakSeconds"] >= 0.2
    assert summary["result"]["xpEarned"] >= 20 and summary["result"]["sam"]["delivery"] >= 1
    kinds = [event["event"] for event in summary["events"] if event.get("who") != "Sam"]
    expected = ["carton.start", "scanner.crash", "scanner.swap", "carton.finish",
                "pick.start", "pick.collected", "pick.finish", "lock-up"]
    positions = [kinds.index(kind) for kind in expected]
    assert positions == sorted(positions), kinds
    page.evaluate("() => { navigator.clipboard.writeText = () => Promise.reject(new Error('denied')); }")
    page.locator("#copyPlaytest").tap()
    page.get_by_text("Select and copy the summary below.").wait_for()
    assert json.loads(page.locator("#playtestReport").input_value()) == summary
    page.locator("#dayNext").tap()
    page.locator("#nextDayBtn").tap()
    page.evaluate("__shift.day().phase = 'lock'; __shift.day().lock()")
    page.locator("#copyPlaytest").tap()
    page.locator("#playtestReport").wait_for(state="visible")
    day_two = json.loads(page.locator("#playtestReport").input_value())["start"]
    assert day_two["day"] == 2
    assert day_two["progression"] == summary["result"]["progression"]
    assert day_two["progression"]["sam"]["speedTier"] == 2
    assert page.evaluate("""keys => Object.fromEntries(Object.keys(localStorage)
      .filter(key => keys.includes(key) || key.startsWith('ws-shift-xp/'))
      .map(key => [key, localStorage.getItem(key)]))""", list(saved_career)) == saved_career
    # Reopening after a playtest restores the regular career and offers a confirmed reset.
    page.reload(wait_until="domcontentloaded")
    page.wait_for_function("!!window.__shift", timeout=100_000)
    assert "442 career XP" in page.locator("#careerXP").inner_text()
    page.get_by_role("button", name="New game", exact=True).tap()
    dialog = page.get_by_role("dialog", name="Start a new game?")
    assert dialog.get_by_text("This will delete all progress and start completely fresh.").is_visible()
    dialog.get_by_role("button", name="Back", exact=True).tap()
    assert not dialog.is_visible()
    assert page.evaluate("localStorage.getItem('ws-shift-xp/regular')") == "442"
    page.get_by_role("button", name="New game", exact=True).tap()
    dialog.get_by_role("button", name="Continue", exact=True).tap()
    dialog.wait_for(state="hidden")
    assert page.evaluate("""keys => {
      const s = __shift, d = s.day();
      return d.firstDay && s.crew.length === 1 &&
        s.players[0].D.xpBalance.textContent === '0 XP' &&
        keys.every(key => localStorage.getItem(key) === null) &&
        localStorage.getItem('ws-sound') === 'off';
    }""", list(saved_career))
    page.evaluate("__shift.day().credit('p1', 'fresh-work', 10)")
    assert page.evaluate("localStorage.getItem('ws-shift-xp/' + __shift.day().shiftId)") is not None
    old_shift = page.evaluate("__shift.day().shiftId")
    page.locator("#menuBtn").tap()
    page.locator("#newGameBtn").tap()
    page.locator("#confirmNewGame").tap()
    page.wait_for_function("old => window.__shift?.day() && __shift.day().shiftId !== old", arg=old_shift)
    assert page.locator("#startCover").is_hidden()
    assert page.evaluate("__shift.players[0].D.xpBalance.textContent") == "0 XP"
    page.context.close()


def tutorial_shift(browser, errors):
    page = open_game(browser, errors, phone=True, online=False, saved_career={"ws-shift-xp/existing": "442"})
    page.set_viewport_size({"width": 420, "height": 800})
    page.add_script_tag(path=Path(__file__).with_name("tutorial-playthrough.js"))
    assert "locked up" in page.evaluate("playTutorial('tour')")
    page.locator("#lessonHome").tap()
    page.wait_for_selector("#tutorialBtn")
    assert "442 career XP" in page.locator("#careerXP").inner_text()
    page.locator("#tutorialBtn").tap()
    page.locator("[data-lesson=kiosk]").tap()
    assert page.locator("#shiftGuide").is_visible()
    page.locator("#lessonExit").tap()
    page.wait_for_selector("#tutorialBtn")
    assert "442 career XP" in page.locator("#careerXP").inner_text()
    page.context.close()


if __name__ == "__main__":
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=os.environ.get("CHROME_BIN"),
            args=["--no-sandbox", "--no-zygote", "--in-process-gpu", "--disable-dev-shm-usage",
                  "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        errors = []
        try:
            desktop_mouse_capture(browser, errors)
            recorded_solo_shift(browser, errors)
            tutorial_shift(browser, errors)
            print("Chromium solo playtest and tutorial passed.", flush=True)
            shared_shift(browser, errors)
            split_shift(browser, errors)
            assert not errors, errors
            print("Rendered host and touch guest, shelf relocation, phone rotation, two-controller split screen and solo playtest export passed.")
        finally:
            browser.close()
