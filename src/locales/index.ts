// 화면 라벨 언어팩. 새 언어는 `xx.json`(ko.json과 같은 키)을 추가하고 아래 messages에 등록.
import ko from './ko.json';

export const messages = { ko };

export type Locale = keyof typeof messages;
export type MessageKey = keyof typeof ko;
