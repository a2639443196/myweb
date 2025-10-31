const sleepSlider = document.querySelector('[data-role="sleep-slider"]');
const sleepValue = document.querySelector('[data-role="sleep-value"]');
const sleepMessage = document.querySelector('[data-role="sleep-message"]');

if (sleepSlider && sleepValue && sleepMessage) {
  const updateSleep = () => {
    const hours = Number(sleepSlider.value);
    sleepValue.textContent = hours.toFixed(1);
    let message = '尝试保持稳定的作息节奏。';
    if (hours >= 7 && hours <= 9) {
      message = '完美！这个时长有助于高质量恢复。';
    } else if (hours < 6) {
      message = '睡眠不足，今晚早点上床充电吧。';
    } else if (hours > 9.5) {
      message = '稍微缩短一些睡眠，保持活力状态。';
    }
    sleepMessage.textContent = message;
  };

  sleepSlider.addEventListener('input', updateSleep);
  updateSleep();
}

const macroInputs = document.querySelectorAll('[data-macro-input]');
const macroDisplays = document.querySelectorAll('[data-macro-display]');
const calorieOutput = document.querySelector('[data-role="calories"]');
const calorieMessage = document.querySelector('[data-role="calorie-message"]');

if (macroInputs.length && calorieOutput && calorieMessage) {
  const macroMap = new Map(
    Array.from(macroDisplays, (el) => [el.dataset.macroDisplay, el])
  );

  const updateNutrition = () => {
    let calories = 0;
    macroInputs.forEach((input) => {
      const grams = Number(input.value);
      const perGram = Number(input.dataset.calPerGram);
      const macro = input.dataset.macroInput;
      calories += grams * perGram;
      const target = macroMap.get(macro);
      if (target) {
        target.textContent = `${grams.toFixed(0)} g`;
      }
    });

    calorieOutput.textContent = Math.round(calories);

    let tip = '根据今天的活动量调整你的能量摄入。';
    if (calories < 1800) {
      tip = '热量略低，可适当增加优质碳水和蛋白质。';
    } else if (calories > 2600) {
      tip = '热量较高，记得平衡运动和饮食。';
    } else {
      tip = '热量区间很棒，继续保持营养均衡。';
    }
    calorieMessage.textContent = tip;
  };

  macroInputs.forEach((input) => {
    input.addEventListener('input', updateNutrition);
  });

  updateNutrition();
}
