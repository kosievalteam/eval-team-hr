-- 회의록 첨부 파일 한도 20MB → 30MB (2026-11-20). 앱(MIN_FILE_MAX)도 30MB로 맞춤.
update storage.buckets set file_size_limit = 31457280 where id = 'hr-minutes';
