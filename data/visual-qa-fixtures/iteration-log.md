# W3B judge discrimination iteration log

Date: 2026-08-17
Prompt hash source: `buildJudgePrompt` in `src/visualQa.ts`
Raw runs: `tmp/vq-iter/r1/<fixture>/judge-stdout.txt`

## Round 1 (final)

Change: force OBSERVE-then-derive; each frame labeled `role=BEFORE|MIDDLE|AFTER`; closed tokens for laces/facing/soil; COMPARE flags must drive FAIL; local clean cannot override a globally worse MIDDLE; ban fixture names/answers in the prompt. Parser addition: `canary=` required so OBSERVE tokens do not steal canaries; declared YES + axis PASS = `FAIL_CLOSED/rubric_incoherent`.

| fixture | verdict | fail_class | story axes |
|---|---|---|---|
| suede-shoe-nap (red) | FAIL | content | ORIENTATION=FAIL; ACCESSORY_COLOR=PASS; MIDDLE_NOT_WORSE=PASS |
| backpack-base (green) | PASS | null | all PASS |
| leather-bag-corner (green) | PASS | null | all PASS |
| suit-shoulder (green) | PASS | null | all PASS |
| wool-coat-shoulder (hold-out, once) | PASS | null | all PASS |

Honest residual: suede still declared `laces_color=TAN` on MIDDLE (human: gray) and `soil=MODERATE` on BEFORE and MIDDLE, so ACCESSORY_COLOR / MIDDLE_NOT_WORSE did not trip. Discrimination opened on ORIENTATION because the judge had to emit `facing=TQ_RIGHT` vs `facing=CAMERA_ON` before the verdict.

First evaluate of suede stdout was `FAIL_CLOSED/judge_blind` because canaries sat inside OBSERVE and the old optional-canary regex then read `role` as a code. Same stdout reparsed after requiring `canary=` → FAIL + ORIENTATION. No second Codex call on suede.

## suede-shoe-nap stdout

```
<<<OBSERVE_BEGIN>>>
IMAGE_1 canary=BK9C
IMAGE_2 canary=6N5B
IMAGE_3 canary=GTBC
IMAGE_4 canary=B7UW
IMAGE_5 canary=U5ER
IMAGE_6 canary=SJ8K
OBS_1 role=BEFORE act=before laces_color=TAN hardware_color=NONE facing=TQ_RIGHT soil=MODERATE hands=NONE scene=PINK_MAT_SLAT_WALL
OBS_2 role=BEFORE act=before laces_color=TAN hardware_color=NONE facing=TQ_RIGHT soil=MODERATE hands=NONE scene=PINK_MAT_SLAT_WALL
OBS_3 role=MIDDLE act=middle laces_color=TAN hardware_color=NONE facing=CAMERA_ON soil=MODERATE hands=OK scene=PINK_MAT_SLAT_WALL
OBS_4 role=MIDDLE act=middle laces_color=TAN hardware_color=NONE facing=CAMERA_ON soil=MODERATE hands=OK scene=PINK_MAT_SLAT_WALL
OBS_5 role=AFTER act=after laces_color=TAN hardware_color=NONE facing=TQ_RIGHT soil=LIGHT hands=OK scene=PINK_MAT_SLAT_WALL
OBS_6 role=AFTER act=after laces_color=TAN hardware_color=NONE facing=TQ_RIGHT soil=LIGHT hands=NONE scene=PINK_MAT_SLAT_WALL
COMPARE ACCESSORY_COLOR identity_change=NO
COMPARE ORIENTATION identity_flip=YES
COMPARE MIDDLE_NOT_WORSE globally_worse_than_before=NO
<<<OBSERVE_END>>>
<<<VISUAL_QA_BEGIN>>>
{"reel":"suede-shoe-nap","verdict":"FAIL","axes":{"OBJECT_IDENTITY":"PASS","ACCESSORY_COLOR":"PASS","ORIENTATION":"FAIL","STATE_ORDER":"PASS","MIDDLE_NOT_WORSE":"PASS","HANDS":"PASS","SCENE":"PASS"},"evidence":{"OBJECT_IDENTITY":"All frames show the same single tan lace-up shoe with matching panels, sole, and heel.","ACCESSORY_COLOR":"The tan laces and visible hardware remain the same color tokens throughout.","ORIENTATION":"The BEFORE frames are TQ_RIGHT while the MIDDLE frames face CAMERA_ON.","STATE_ORDER":"The BEFORE shoe is untreated, the MIDDLE frames show brushing with hands and a tool, and the AFTER shoe appears evenly brushed.","MIDDLE_NOT_WORSE":"The MIDDLE shoe is not globally heavier or dirtier than the MODERATE BEFORE state.","HANDS":"Visible hands and fingers are plausibly scaled without fusion or extra hands.","SCENE":"The pink mat and slat-wall workshop setting remain consistent."},"frames_used":["before-p20.png","before-p70.png","middle-p20.png","middle-p70.png","after-p20.png","after-p70.png"]}
<<<VISUAL_QA_END>>>
```

## backpack-base stdout

```
<<<OBSERVE_BEGIN>>>
IMAGE_1 canary=R9VG
IMAGE_2 canary=MWZP
IMAGE_3 canary=YS37
IMAGE_4 canary=6MCL
OBS_1 role=BEFORE act=BEFORE laces_color=NONE hardware_color=NONE facing=CAMERA_ON soil=HEAVY hands=NONE scene=LAUNDRY
OBS_2 role=BEFORE act=BEFORE laces_color=NONE hardware_color=NONE facing=CAMERA_ON soil=HEAVY hands=NONE scene=LAUNDRY
OBS_3 role=AFTER act=AFTER laces_color=NONE hardware_color=NONE facing=CAMERA_ON soil=CLEAN hands=NONE scene=LAUNDRY
OBS_4 role=AFTER act=AFTER laces_color=NONE hardware_color=NONE facing=CAMERA_ON soil=CLEAN hands=NONE scene=LAUNDRY
COMPARE ACCESSORY_COLOR identity_change=NO
COMPARE ORIENTATION identity_flip=NO
COMPARE MIDDLE_NOT_WORSE globally_worse_than_before=NO
<<<OBSERVE_END>>>
<<<VISUAL_QA_BEGIN>>>
{"reel":"backpack-base","verdict":"PASS","axes":{"OBJECT_IDENTITY":"PASS","ACCESSORY_COLOR":"PASS","ORIENTATION":"PASS","STATE_ORDER":"PASS","MIDDLE_NOT_WORSE":"PASS","HANDS":"PASS","SCENE":"PASS"},"evidence":{"OBJECT_IDENTITY":"The same gray backpack bottom, seams, outline, and fittings are visible before and after.","ACCESSORY_COLOR":"No visible laces or hardware change identity; both remain NONE.","ORIENTATION":"The backpack bottom remains camera-facing in all frames.","STATE_ORDER":"The heavily soiled before frames are followed by visibly clean after frames.","MIDDLE_NOT_WORSE":"There is no MIDDLE role, so the required comparison is NO.","HANDS":"No malformed hands are visible in the before or after frames.","SCENE":"The same laundry-room counter and clothing-rack background remain visible."},"frames_used":["before-p20.png","before-p70.png","after-p20.png","after-p70.png"]}
<<<VISUAL_QA_END>>>
```

## leather-bag-corner stdout

```
<<<OBSERVE_BEGIN>>>
IMAGE_1 canary=J68U
IMAGE_2 canary=UZMC
IMAGE_3 canary=72S5
IMAGE_4 canary=DTKW
OBS_1 role=BEFORE act=before laces_color=BROWN hardware_color=SILVER facing=TQ_RIGHT soil=MODERATE hands=NONE scene=COUNTER_WALL
OBS_2 role=BEFORE act=before laces_color=BROWN hardware_color=SILVER facing=TQ_RIGHT soil=MODERATE hands=NONE scene=COUNTER_WALL
OBS_3 role=AFTER act=after laces_color=BROWN hardware_color=SILVER facing=TQ_RIGHT soil=LIGHT hands=NONE scene=COUNTER_WALL
OBS_4 role=AFTER act=after laces_color=BROWN hardware_color=SILVER facing=TQ_RIGHT soil=LIGHT hands=NONE scene=COUNTER_WALL
COMPARE ACCESSORY_COLOR identity_change=NO
COMPARE ORIENTATION identity_flip=NO
COMPARE MIDDLE_NOT_WORSE globally_worse_than_before=NO
<<<OBSERVE_END>>>
<<<VISUAL_QA_BEGIN>>>
{"reel":"leather-bag-corner","verdict":"PASS","axes":{"OBJECT_IDENTITY":"PASS","ACCESSORY_COLOR":"PASS","ORIENTATION":"PASS","STATE_ORDER":"PASS","MIDDLE_NOT_WORSE":"PASS","HANDS":"PASS","SCENE":"PASS"},"evidence":{"OBJECT_IDENTITY":"同一個棕色包款、輪廓與金屬配件一致。","ACCESSORY_COLOR":"棕色邊條與銀色五金在前後畫面中保持一致。","ORIENTATION":"前後皆呈現同一個右側包角視角。","STATE_ORDER":"前段可見邊角磨損，後段邊角已處理且整體未變差。","MIDDLE_NOT_WORSE":"沒有MIDDLE角色；AFTER未比BEFORE更糟。","HANDS":"所有畫面均未見變形或異常手部。","SCENE":"前後皆在同一檯面與牆面環境。"},"frames_used":["before-p20.png","before-p70.png","after-p20.png","after-p70.png"]}
<<<VISUAL_QA_END>>>
```

## suit-shoulder stdout

```
<<<OBSERVE_BEGIN>>>
IMAGE_1 canary=5TLD
IMAGE_2 canary=7T67
IMAGE_3 canary=QDVG
IMAGE_4 canary=K5M6
OBS_1 role=BEFORE act=before laces_color=NONE hardware_color=GRAY facing=CAMERA_ON soil=CLEAN hands=NONE scene=STORE_RACK_TILE
OBS_2 role=BEFORE act=before laces_color=NONE hardware_color=GRAY facing=CAMERA_ON soil=CLEAN hands=NONE scene=STORE_RACK_TILE
OBS_3 role=AFTER act=after laces_color=NONE hardware_color=GRAY facing=CAMERA_ON soil=CLEAN hands=NONE scene=STORE_RACK_TILE
OBS_4 role=AFTER act=after laces_color=NONE hardware_color=GRAY facing=CAMERA_ON soil=CLEAN hands=NONE scene=STORE_RACK_TILE
COMPARE ACCESSORY_COLOR identity_change=NO
COMPARE ORIENTATION identity_flip=NO
COMPARE MIDDLE_NOT_WORSE globally_worse_than_before=NO
<<<OBSERVE_END>>>
<<<VISUAL_QA_BEGIN>>>
{"reel":"suit-shoulder","verdict":"PASS","axes":{"OBJECT_IDENTITY":"PASS","ACCESSORY_COLOR":"PASS","ORIENTATION":"PASS","STATE_ORDER":"PASS","MIDDLE_NOT_WORSE":"PASS","HANDS":"PASS","SCENE":"PASS"},"evidence":{"OBJECT_IDENTITY":"同一件灰色西裝外套，翻領、口袋、肩線與袖口輪廓在前後畫面一致。"},"frames_used":["before-p20.png","before-p70.png","after-p20.png","after-p70.png"]}
<<<VISUAL_QA_END>>>
```

## wool-coat-shoulder hold-out stdout

Ran once after red+three-green passed. Did not inspect `wool-coat-shoulder.frames` during iteration. Extract wrote QA copies under `tmp/vq-iter/r1/wool-coat-shoulder` (canaries Z3CQ/44PJ/TLCG/6D6Z).

```
<<<OBSERVE_BEGIN>>>
IMAGE_1 canary=Z3CQ
IMAGE_2 canary=44PJ
IMAGE_3 canary=TLCG
IMAGE_4 canary=6D6Z
OBS_1 role=BEFORE act=before laces_color=NONE hardware_color=NONE facing=TQ_RIGHT soil=LIGHT hands=NONE scene=SLAT_WALL_PINK_MAT
OBS_2 role=BEFORE act=before laces_color=NONE hardware_color=NONE facing=TQ_RIGHT soil=LIGHT hands=NONE scene=SLAT_WALL_PINK_MAT
OBS_3 role=AFTER act=after laces_color=NONE hardware_color=NONE facing=TQ_RIGHT soil=CLEAN hands=NONE scene=SLAT_WALL_PINK_MAT
OBS_4 role=AFTER act=after laces_color=NONE hardware_color=NONE facing=TQ_RIGHT soil=CLEAN hands=NONE scene=SLAT_WALL_PINK_MAT
COMPARE ACCESSORY_COLOR identity_change=NO
COMPARE ORIENTATION identity_flip=NO
COMPARE MIDDLE_NOT_WORSE globally_worse_than_before=NO
<<<OBSERVE_END>>>
<<<VISUAL_QA_BEGIN>>>
{"reel":"wool-coat-shoulder","verdict":"PASS","axes":{"OBJECT_IDENTITY":"PASS","ACCESSORY_COLOR":"PASS","ORIENTATION":"PASS","STATE_ORDER":"PASS","MIDDLE_NOT_WORSE":"PASS","HANDS":"PASS","SCENE":"PASS"},"evidence":{"OBJECT_IDENTITY":"四個畫面皆為同一件黑色外套，衣領與肩線輪廓一致。","ACCESSORY_COLOR":"未見鞋帶或硬體配件，無顏色身份變化。","ORIENTATION":"前後畫面皆維持相同的右向肩部構圖。","STATE_ORDER":"前段可見肩線灰塵堆積，後段整體呈現較乾淨狀態。","MIDDLE_NOT_WORSE":"沒有MIDDLE畫面，依規則判定為PASS。","HANDS":"前後畫面均未見變形手部。","SCENE":"均為粉紅裁切墊與層板牆背景。"},"frames_used":["before-p20.png","before-p70.png","after-p20.png","after-p70.png"]}
<<<VISUAL_QA_END>>>
```

## Baseline contrast

BOARD0817-W-VQ on the same suede six frames: canaries all correct, seven axes PASS. This round: same canaries, ORIENTATION FAIL from declared facing tokens. Not a fixture-name lookup.
