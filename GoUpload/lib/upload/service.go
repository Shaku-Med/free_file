package upload

import (
	"io"
	"time"
)

type Service struct {
	manager *manager
}

func NewService(maxSize int64, ttl time.Duration) *Service {
	return &Service{manager: newManager(maxSize, ttl)}
}

func (s *Service) StartResumable(size int64) (string, error) {
	session, err := s.manager.start(size)
	if err != nil {
		return "", err
	}
	return session.id, nil
}

func (s *Service) AppendResumable(id string, start, end, total int64, body io.Reader) (int64, bool, error) {
	session, complete, err := s.manager.appendChunk(id, body, start, end, total)
	if err != nil {
		return 0, false, err
	}
	return session.received, complete, nil
}

func (s *Service) UploadSingle(reader io.Reader, size int64) (string, int64, error) {
	session, err := s.manager.uploadSingle(reader, size)
	if err != nil {
		return "", 0, err
	}
	return session.id, session.received, nil
}
